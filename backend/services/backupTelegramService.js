/*
 * Purpose: Ship a consistent, compressed snapshot of the SQLite database to a Telegram chat, so the
 *          database survives losing the box itself.
 * Caller: server.js daily scheduler, routes/backupTelegramRoutes.js (admin "send now").
 * Deps: settingsService (chat id + enable flag), telegramDocumentSender (token + upload), node:zlib, node:fs.
 * MainFuncs: createDatabaseSnapshot, sendDatabaseBackup, runScheduledBackup.
 * SideEffects: Writes a temp snapshot under data/backups/, uploads it to Telegram, deletes the temp.
 *
 * Why VACUUM INTO and not a file copy: this database runs in WAL mode, so the .db file on disk is
 * NOT a complete database on its own — recent commits live in -wal. Copying it while the app is
 * running yields a torn snapshot that can restore short, or not at all. `VACUUM INTO` asks SQLite
 * itself for a consistent copy, and compacts it on the way out (measured on prod: 77.7 MB -> 73.4 MB,
 * then 12.5 MB gzipped, comfortably inside the 50 MB Bot API limit).
 */

import { createGzip } from 'zlib';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, readFileSync } from 'fs';
import { pipeline } from 'stream/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../database/connectionPool.js';
import settingsService from './settingsService.js';
import { sendTelegramDocument, isTelegramTokenConfigured } from './telegramDocumentSender.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const BACKUP_DIR = join(DATA_DIR, 'backups');

// Telegram's cloud Bot API refuses documents over 50 MB. Measured headroom is large (12.5 MB), but
// a growing database must fail LOUDLY here rather than have Telegram reject the upload silently.
const TELEGRAM_DOCUMENT_LIMIT_BYTES = 50 * 1024 * 1024;

export const BACKUP_SETTING_KEYS = {
    enabled: 'backup_telegram_enabled',
    chatId: 'backup_telegram_chat_id',
    lastRunAt: 'backup_telegram_last_run_at',
};

// A backup is due when the last SUCCESSFUL one is older than this. Persisted rather than held in
// memory on purpose — see scheduleDailyBackup in server.js for the restart problem it solves.
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function readSetting(key, fallback = '') {
    try {
        return settingsService.getSetting(key)?.value ?? fallback;
    } catch {
        // getSetting throws 404 when the key was never written — that is a normal "not configured".
        return fallback;
    }
}

export function getBackupTelegramConfig() {
    const raw = readSetting(BACKUP_SETTING_KEYS.enabled, 'false');
    return {
        enabled: raw === true || raw === 'true' || raw === 1 || raw === '1',
        chatId: String(readSetting(BACKUP_SETTING_KEYS.chatId, '') || '').trim(),
    };
}

/**
 * When did the last SUCCESSFUL backup finish?
 * @returns {number|null} epoch ms, or null if one has never completed
 */
export function getLastBackupAt() {
    const raw = readSetting(BACKUP_SETTING_KEYS.lastRunAt, '');
    const parsed = Date.parse(String(raw || ''));
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Is a scheduled backup owed right now?
 *
 * This is the whole reason the timestamp is persisted. The scheduler used to be a single
 * `setTimeout(..., 24h)` anchored at boot, so the backup only ever happened if the process
 * survived a full day uninterrupted — and this backend had restarted 36 times. A box that
 * restarts more often than daily would have produced backups FOREVER NEVER while logging that
 * they were scheduled. Anchoring on the last success instead makes it restart-proof: at most one
 * backup per interval, and at least one per interval as long as the process is up at some point.
 *
 * @param {number} [now] epoch ms, injectable for tests
 */
export function isBackupDue(now = Date.now()) {
    const last = getLastBackupAt();
    return last === null || now - last >= BACKUP_INTERVAL_MS;
}

/**
 * Consistent + compressed snapshot of the live database.
 * @returns {{ path: string, bytes: number, filename: string }}
 */
export async function createDatabaseSnapshot({ now = new Date() } = {}) {
    if (!existsSync(BACKUP_DIR)) {
        mkdirSync(BACKUP_DIR, { recursive: true });
    }

    const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rawPath = join(BACKUP_DIR, `snapshot_${stamp}.db`);
    const gzPath = `${rawPath}.gz`;

    // Leftovers from a previous crashed run would make VACUUM INTO fail (it refuses to overwrite).
    for (const stale of [rawPath, gzPath]) {
        if (existsSync(stale)) unlinkSync(stale);
    }

    // VACUUM INTO needs a real read-write handle, which the readonly pool cannot give —
    // so this is the one place that reaches for the writer directly rather than going
    // through query/execute. It also cannot run inside a transaction, which is why the
    // backup is only ever driven from the scheduler, never from inside one.
    pool.getWriteConnection().prepare('VACUUM INTO ?').run(rawPath);

    try {
        await pipeline(createReadStream(rawPath), createGzip({ level: 6 }), createWriteStream(gzPath));
    } finally {
        // The uncompressed copy is a full second database on the same disk — never leave it behind.
        if (existsSync(rawPath)) unlinkSync(rawPath);
    }

    return { path: gzPath, bytes: statSync(gzPath).size, filename: `cctv_${stamp}.db.gz` };
}

/**
 * Build a snapshot and push it to Telegram. Throws with a human-readable message on any refusal so
 * the admin UI can show exactly what to fix.
 */
export async function sendDatabaseBackup({ chatId = null, reason = 'manual' } = {}) {
    const config = getBackupTelegramConfig();
    const targetChatId = String(chatId || config.chatId || '').trim();
    if (!targetChatId) {
        const err = new Error('Chat ID belum diisi — set dulu di Pengaturan > Backup.');
        err.statusCode = 400;
        throw err;
    }

    if (!isTelegramTokenConfigured()) {
        const err = new Error('Bot token Telegram belum diatur.');
        err.statusCode = 400;
        throw err;
    }

    const snapshot = await createDatabaseSnapshot();
    try {
        if (snapshot.bytes > TELEGRAM_DOCUMENT_LIMIT_BYTES) {
            const err = new Error(
                `Snapshot ${(snapshot.bytes / 1048576).toFixed(1)} MB melebihi batas Telegram 50 MB. `
                + 'Arahkan ke Bot API lokal atau pangkas data historis.'
            );
            err.statusCode = 413;
            throw err;
        }

        const sizeMb = (snapshot.bytes / 1048576).toFixed(1);
        await sendTelegramDocument(targetChatId, {
            buffer: readFileSync(snapshot.path),
            filename: snapshot.filename,
            caption: `🗄️ <b>Backup database CCTV</b>\n`
                + `Ukuran: ${sizeMb} MB (gzip)\n`
                + `Waktu: ${new Date().toISOString()}\n`
                + `Pemicu: ${reason}\n\n`
                + `Pulihkan: <code>gunzip -c &lt;file&gt; &gt; cctv.db</code>`,
        });

        return { sent: true, bytes: snapshot.bytes, filename: snapshot.filename, chatId: targetChatId };
    } finally {
        // Telegram now holds the copy that matters; keeping a second one here just fills the disk
        // this backup exists to survive.
        if (existsSync(snapshot.path)) unlinkSync(snapshot.path);
    }
}

/** Daily entry point. Silent + harmless when the operator has not enabled it. */
export async function runScheduledBackup({ now = Date.now(), force = false } = {}) {
    const config = getBackupTelegramConfig();
    if (!config.enabled || !config.chatId) {
        return { skipped: true, reason: 'not_configured' };
    }

    // The scheduler now ticks hourly rather than daily (so a restart cannot starve the backup),
    // which makes this the thing that keeps it to one per day. The admin "send now" route calls
    // sendDatabaseBackup directly and is deliberately not subject to it.
    if (!force && !isBackupDue(now)) {
        return { skipped: true, reason: 'not_due' };
    }

    try {
        const result = await sendDatabaseBackup({ chatId: config.chatId, reason: 'terjadwal' });
        settingsService.updateSetting(
            BACKUP_SETTING_KEYS.lastRunAt,
            new Date(now).toISOString(),
            'Waktu backup database terjadwal terakhir yang BERHASIL terkirim'
        );
        console.log(`[Backup] Database backup sent to Telegram (${(result.bytes / 1048576).toFixed(1)} MB)`);
        return result;
    } catch (error) {
        // A failed backup is exactly the kind of thing that must reach stderr: it is silent
        // otherwise, and you only discover it when you need the backup.
        console.error('[Backup] Scheduled database backup FAILED:', error.message);
        return { sent: false, error: error.message };
    }
}

/**
 * Arm the recurring backup and report the REAL state at boot.
 *
 * The scheduler used to be a single `setTimeout(..., 24h)` in server.js, anchored at boot and
 * re-armed after each run — so a backup only ever happened if the process survived a full
 * uninterrupted day. Production had booted 36 times and produced ZERO backups while printing
 * "Daily Telegram database backup scheduled" on every one of those boots. Ticking hourly and
 * letting isBackupDue() decide makes it restart-proof: at most one per day, at least one per day
 * as long as the process is up at some point.
 *
 * The boot line says what is true. "Scheduled" on a box with no chat id is the same false
 * reassurance /health used to give about rate limiting — an operator reads it, believes the
 * database leaves the box, and finds out otherwise on the day the disk dies.
 *
 * @returns {{ configured: boolean }}
 */
export function startScheduledBackups({ tickMs = 60 * 60 * 1000, firstTickMs = 5 * 60 * 1000 } = {}) {
    const tick = () => runScheduledBackup()
        .catch((error) => console.error('[Backup] Scheduled backup tick failed:', error.message));

    setTimeout(tick, firstTickMs).unref();
    setInterval(tick, tickMs).unref();

    const config = getBackupTelegramConfig();
    const configured = Boolean(config.enabled && config.chatId);
    if (configured) {
        const last = getLastBackupAt();
        console.log(`[Backup] Off-box backup active (last success: ${last ? new Date(last).toISOString() : 'belum pernah'})`);
    } else {
        console.warn('[Backup] TIDAK DIKONFIGURASI — tidak ada salinan database yang keluar dari box ini. Set chat id + aktifkan di Pengaturan > Backup.');
    }
    return { configured };
}

export default {
    createDatabaseSnapshot,
    startScheduledBackups,
    sendDatabaseBackup,
    runScheduledBackup,
    getBackupTelegramConfig,
    getLastBackupAt,
    isBackupDue,
    BACKUP_SETTING_KEYS,
    BACKUP_INTERVAL_MS,
};
