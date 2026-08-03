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
const backupDir = new URL('../data/backups/', import.meta.url);
const leftoverSnapshots = () => {
    try {
        return readdirSync(backupDir).filter((f) => f.startsWith('snapshot_'));
    } catch {
        return []; // never created = nothing left behind
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
});

beforeEach(() => {
    h.settings.clear();
    h.sent.length = 0;
    h.tokenConfigured = true;
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
