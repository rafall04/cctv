/**
 * Purpose: Prove the off-box database backup actually produces a restorable file.
 * Caller: Vitest backend suite.
 * Deps: better-sqlite3 (real file), settingsService + telegramDocumentSender mocked.
 * MainFuncs: getBackupTelegramConfig, createDatabaseSnapshot, sendDatabaseBackup, runScheduledBackup.
 * SideEffects: Writes snapshots under a temp dir; no network, no real Telegram call.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Coverage put this service at 0%, which is a bad place for it to be: it is the only thing
 * standing between this deployment and losing the payments, wallet ledger and customer
 * accounts if the disk goes. It is also the module whose VACUUM INTO call was rewritten
 * during the connectionPool convergence (it reaches for the writer directly, because a
 * readonly pool connection cannot vacuum) — a change that nothing verified until now.
 *
 * So the snapshot test runs a REAL `VACUUM INTO` against a REAL database and then opens the
 * result and reads the rows back. A mock would have happily reported success on a file that
 * could not be restored, which is the only failure mode that actually matters here.
 */
import Database from 'better-sqlite3';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const h = await vi.hoisted(async () => ({ settings: new Map(), sent: [], tokenConfigured: true }));

vi.mock('../services/settingsService.js', () => ({
    default: {
        getSetting: (key) => {
            if (!h.settings.has(key)) {
                const err = new Error('Setting not found');
                err.statusCode = 404;
                throw err;
            }
            return { value: h.settings.get(key) };
        },
        // Writes go back into the same map, so "did the last-run timestamp actually persist?"
        // is observable — that timestamp is what makes the schedule survive a restart.
        updateSetting: (key, value) => {
            h.settings.set(key, String(value));
            return { key, value };
        },
    },
}));

vi.mock('../services/telegramDocumentSender.js', () => ({
    sendTelegramDocument: async (chatId, doc) => { h.sent.push({ chatId, ...doc }); return { ok: true }; },
    isTelegramTokenConfigured: () => h.tokenConfigured,
}));

let dir;
let dbFile;
let service;

// The service resolves its output dir relative to its OWN module path (backend/data/backups),
// not to DATABASE_PATH — so that is where the assertions have to look. Checking for leftover
// `snapshot_*` files specifically keeps this tolerant of anything else living in there.
// (On disk the files are `snapshot_<stamp>.db[.gz]`; `cctv_<stamp>.db.gz` is only the name the
// upload is given, so the on-disk prefix is the right thing to filter on.)
const backupDir = new URL('../data/backups/', import.meta.url);
const leftoverSnapshots = () => {
    try {
        return readdirSync(backupDir).filter((f) => f.startsWith('snapshot_'));
    } catch {
        return []; // never created = nothing left behind
    }
};

/*
 * Because BACKUP_DIR is a REAL shared directory, a snapshot one test forgets does not just
 * affect the next assertion — it survives the process and fails every future run until someone
 * deletes it by hand. That is exactly what happened: the "produces a gzip" test below created a
 * snapshot and never removed it, and whether the leak was VISIBLE depended on the wall clock,
 * because the filename stamp has one-second resolution. Land the next test in the same second
 * and it silently overwrote the leak; land it a second later and the file survived and broke
 * every `leftoverSnapshots()` assertion from then on, in this run and all subsequent ones.
 *
 * So no test is allowed to depend on another's timing: the directory is swept clean before each
 * one, and again at the end so a run never hands debris to the next.
 */
const clearSnapshots = () => {
    for (const file of leftoverSnapshots()) {
        try { rmSync(new URL(file, backupDir), { force: true }); } catch { /* already gone */ }
    }
};

beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'backupsvc-'));
    dbFile = join(dir, 'cctv.db');

    const seed = new Database(dbFile);
    seed.pragma('journal_mode = WAL');
    seed.exec('CREATE TABLE payments (id INTEGER PRIMARY KEY, amount INTEGER NOT NULL, ref TEXT)');
    const ins = seed.prepare('INSERT INTO payments (amount, ref) VALUES (?, ?)');
    for (let i = 1; i <= 25; i += 1) ins.run(i * 1000, `INV-${i}`);
    seed.close();

    process.env.DATABASE_PATH = dbFile;
    service = await import('../services/backupTelegramService.js');
});

afterAll(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* disposable */ }
    clearSnapshots();
});

beforeEach(() => {
    h.settings.clear();
    h.sent.length = 0;
    h.tokenConfigured = true;
    clearSnapshots();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getBackupTelegramConfig', () => {
    it('reports not-configured when nothing has been set', () => {
        expect(service.getBackupTelegramConfig()).toEqual({ enabled: false, chatId: '' });
    });

    it.each(['true', true, 1, '1'])('accepts %s as enabled', (value) => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, value);
        expect(service.getBackupTelegramConfig().enabled).toBe(true);
    });

    it('treats anything else as disabled', () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, 'yes');
        expect(service.getBackupTelegramConfig().enabled).toBe(false);
    });

    it('trims the chat id', () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.chatId, '  -1001234  ');
        expect(service.getBackupTelegramConfig().chatId).toBe('-1001234');
    });
});

describe('createDatabaseSnapshot', () => {
    /*
     * THE TEST THAT MATTERS. A backup that cannot be restored is worse than no backup,
     * because it is believed. So: take a real snapshot, gunzip it, open it as a database,
     * and read the rows.
     */
    it('produces a gzip that unpacks into a readable database with the same rows', async () => {
        const snapshot = await service.createDatabaseSnapshot();

        expect(existsSync(snapshot.path)).toBe(true);
        expect(snapshot.filename).toMatch(/^cctv_.*\.db\.gz$/);
        expect(snapshot.bytes).toBeGreaterThan(0);

        const restored = join(dir, 'restored.db');
        await pipeline(createReadStream(snapshot.path), createGunzip(), createWriteStream(restored));

        const db = new Database(restored, { readonly: true, fileMustExist: true });
        expect(db.prepare('SELECT COUNT(*) c FROM payments').get().c).toBe(25);
        expect(db.prepare('SELECT amount, ref FROM payments WHERE id = 7').get())
            .toEqual({ amount: 7000, ref: 'INV-7' });
        db.close();
        // Was the one snapshot in this file nobody deleted — see clearSnapshots() above.
        rmSync(snapshot.path, { force: true });
    });

    it('never leaves the uncompressed copy behind — it is a second full database on the same disk', async () => {
        const snapshot = await service.createDatabaseSnapshot();
        // The .gz is expected to still be there (the caller uploads then deletes it); the
        // raw .db beside it must be gone.
        expect(leftoverSnapshots().filter((f) => f.endsWith('.db'))).toEqual([]);
        rmSync(snapshot.path, { force: true });
    });

    it('overwrites a leftover snapshot from a crashed run instead of failing', async () => {
        // VACUUM INTO refuses to write over an existing file, so a crash mid-backup would
        // otherwise wedge every subsequent attempt at the same timestamp.
        const now = new Date('2026-08-03T04:05:06.000Z');
        const first = await service.createDatabaseSnapshot({ now });
        await expect(service.createDatabaseSnapshot({ now })).resolves.toMatchObject({ path: first.path });
        // This one pins a fixed timestamp, so it has to clear up after itself — otherwise the
        // "nothing left behind" assertions further down would be looking at this file.
        rmSync(first.path, { force: true });
    });
});

describe('sendDatabaseBackup', () => {
    it('refuses with a 400 the admin can act on when no chat id is set', async () => {
        await expect(service.sendDatabaseBackup()).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('Chat ID'),
        });
        expect(h.sent).toHaveLength(0);
    });

    it('refuses with a 400 when the bot token is missing', async () => {
        h.tokenConfigured = false;
        await expect(service.sendDatabaseBackup({ chatId: '-100' })).rejects.toMatchObject({
            statusCode: 400,
            message: expect.stringContaining('token'),
        });
    });

    it('uploads the snapshot and then deletes the local copy', async () => {
        const result = await service.sendDatabaseBackup({ chatId: '-1001234', reason: 'manual' });

        expect(result).toMatchObject({ sent: true, chatId: '-1001234' });
        expect(h.sent).toHaveLength(1);
        expect(h.sent[0].chatId).toBe('-1001234');
        expect(h.sent[0].filename).toBe(result.filename);
        expect(Buffer.isBuffer(h.sent[0].buffer)).toBe(true);
        expect(h.sent[0].buffer.length).toBe(result.bytes);
        // The caption has to carry the restore command — a backup nobody knows how to
        // restore is only half a backup.
        expect(h.sent[0].caption).toContain('gunzip');

        // Telegram holds the copy that matters now; a second one here just fills the disk
        // this backup exists to survive.
        expect(leftoverSnapshots()).toEqual([]);
    });

    it('cleans up the snapshot even when the upload throws', async () => {
        const sender = await import('../services/telegramDocumentSender.js');
        vi.spyOn(sender, 'sendTelegramDocument').mockRejectedValue(new Error('network down'));

        await expect(service.sendDatabaseBackup({ chatId: '-100' })).rejects.toThrow('network down');
        expect(leftoverSnapshots()).toEqual([]);
    });

    it('prefers an explicitly passed chat id over the configured one', async () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.chatId, '-100CONFIG');
        await service.sendDatabaseBackup({ chatId: '-100EXPLICIT' });
        expect(h.sent[0].chatId).toBe('-100EXPLICIT');
    });
});

describe('runScheduledBackup', () => {
    /*
     * This is the path that has been running on production every 24h since install and
     * doing nothing, because the operator never set a chat id. Being a silent no-op is
     * correct — but it must be a no-op, not a crash, and it must not be silent when it
     * genuinely fails.
     */
    it('skips quietly when the operator has not configured it', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        await expect(service.runScheduledBackup()).resolves.toEqual({ skipped: true, reason: 'not_configured' });
        expect(h.sent).toHaveLength(0);
        expect(err).not.toHaveBeenCalled();
    });

    it('skips when enabled but no chat id was ever entered', async () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, 'true');
        await expect(service.runScheduledBackup()).resolves.toMatchObject({ skipped: true });
    });

    it('runs once both settings are present', async () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, 'true');
        h.settings.set(service.BACKUP_SETTING_KEYS.chatId, '-1009999');
        vi.spyOn(console, 'log').mockImplementation(() => {});

        const result = await service.runScheduledBackup();
        expect(result.sent).toBe(true);
        expect(h.sent[0].chatId).toBe('-1009999');
    });

    it('reports a failure on stderr instead of swallowing it', async () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, 'true');
        h.settings.set(service.BACKUP_SETTING_KEYS.chatId, '-1009999');
        const sender = await import('../services/telegramDocumentSender.js');
        vi.spyOn(sender, 'sendTelegramDocument').mockRejectedValue(new Error('Telegram 502'));
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await service.runScheduledBackup();

        expect(result).toMatchObject({ sent: false, error: 'Telegram 502' });
        // You only find out a backup was broken when you need it, so this one has to shout.
        expect(err).toHaveBeenCalled();
        expect(err.mock.calls[0][0]).toContain('FAILED');
    });
});

/*
 * THE BUG THIS SUITE EXISTED ALONGSIDE AND NEVER CAUGHT.
 *
 * The scheduler was one `setTimeout(..., 24h)` anchored at boot, so a backup only happened if the
 * process survived a full uninterrupted day. Production had booted 36 times and produced ZERO
 * backups — data/backups was empty — while logging "Daily Telegram database backup scheduled" on
 * every one of those boots. Every test above passed the whole time, because they all call
 * runScheduledBackup() directly and never asked when, or whether, anything would call it.
 *
 * Anchoring on the last SUCCESSFUL run instead of on boot is what makes it restart-proof, so that
 * is what these pin.
 */
describe('backup schedule survives restarts', () => {
    const configure = () => {
        h.settings.set(service.BACKUP_SETTING_KEYS.enabled, 'true');
        h.settings.set(service.BACKUP_SETTING_KEYS.chatId, '-1009999');
        vi.spyOn(console, 'log').mockImplementation(() => {});
    };

    it('is due when one has never run', () => {
        expect(service.getLastBackupAt()).toBeNull();
        expect(service.isBackupDue()).toBe(true);
    });

    it('records the timestamp of a successful run, so a fresh boot can see it', async () => {
        configure();
        const now = Date.parse('2026-08-03T10:00:00.000Z');

        await service.runScheduledBackup({ now });

        // Persisted through settings — NOT held in a module variable a restart would wipe.
        expect(h.settings.get(service.BACKUP_SETTING_KEYS.lastRunAt)).toBe('2026-08-03T10:00:00.000Z');
        expect(service.getLastBackupAt()).toBe(now);
    });

    it('does not send again within the interval, however many times the box reboots', async () => {
        configure();
        const now = Date.parse('2026-08-03T10:00:00.000Z');
        await service.runScheduledBackup({ now });
        expect(h.sent).toHaveLength(1);

        // Every one of these stands for a restart that used to re-arm a fresh 24h timer.
        for (const offsetHours of [1, 5, 12, 23]) {
            const result = await service.runScheduledBackup({ now: now + offsetHours * 3600_000 });
            expect(result).toEqual({ skipped: true, reason: 'not_due' });
        }
        expect(h.sent).toHaveLength(1);
    });

    it('sends again once the interval has genuinely elapsed', async () => {
        configure();
        const now = Date.parse('2026-08-03T10:00:00.000Z');
        await service.runScheduledBackup({ now });

        const later = now + service.BACKUP_INTERVAL_MS;
        expect(service.isBackupDue(later)).toBe(true);
        await service.runScheduledBackup({ now: later });
        expect(h.sent).toHaveLength(2);
    });

    it('a failed send does NOT mark the day as done', async () => {
        configure();
        const sender = await import('../services/telegramDocumentSender.js');
        vi.spyOn(sender, 'sendTelegramDocument').mockRejectedValue(new Error('Telegram 502'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        await service.runScheduledBackup({ now: Date.parse('2026-08-03T10:00:00.000Z') });

        // Otherwise one bad night would silently cost a whole day of protection.
        expect(service.getLastBackupAt()).toBeNull();
        expect(service.isBackupDue()).toBe(true);
    });

    it('startScheduledBackups WARNS when nothing will ever be sent', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.spyOn(console, 'log').mockImplementation(() => {});

        expect(service.startScheduledBackups()).toEqual({ configured: false });

        // The old boot line claimed "scheduled" here — the same false reassurance /health used to
        // give about rate limiting.
        expect(warn).toHaveBeenCalled();
        expect(warn.mock.calls[0][0]).toContain('TIDAK DIKONFIGURASI');
    });

    it('startScheduledBackups reports active once it is configured', () => {
        configure();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        expect(service.startScheduledBackups()).toEqual({ configured: true });
        expect(warn).not.toHaveBeenCalled();
    });
});
