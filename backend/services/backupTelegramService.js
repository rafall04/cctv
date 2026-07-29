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
import { db } from '../database/database.js';
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
};

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

    db.prepare('VACUUM INTO ?').run(rawPath);

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
export async function runScheduledBackup() {
    const config = getBackupTelegramConfig();
    if (!config.enabled || !config.chatId) {
        return { skipped: true, reason: 'not_configured' };
    }

    try {
        const result = await sendDatabaseBackup({ chatId: config.chatId, reason: 'terjadwal' });
        console.log(`[Backup] Database backup sent to Telegram (${(result.bytes / 1048576).toFixed(1)} MB)`);
        return result;
    } catch (error) {
        // A failed backup is exactly the kind of thing that must reach stderr: it is silent
        // otherwise, and you only discover it when you need the backup.
        console.error('[Backup] Scheduled database backup FAILED:', error.message);
        return { sent: false, error: error.message };
    }
}

export default { createDatabaseSnapshot, sendDatabaseBackup, runScheduledBackup, getBackupTelegramConfig, BACKUP_SETTING_KEYS };
