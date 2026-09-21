/*
 * Purpose: Guaranteed daily LOCAL database snapshot with bounded retention — the last
 *          resort restore point when Telegram backup is unconfigured/unreachable and the
 *          deploy-time `.backup-*` copies are too old. Unconditional: a box with no Telegram
 *          chat id must still produce a restorable file every day.
 * Caller: server.js scheduler (same hourly tick pattern as backupTelegramService).
 * Deps: backupTelegramService.createDatabaseSnapshot (VACUUM INTO + gzip — WAL-safe).
 * MainFuncs: runLocalBackup, startLocalBackups, pruneLocalSnapshots, isLocalBackupDue.
 * SideEffects: Writes data/backups/cctv_<stamp>.db.gz; deletes snapshots past the keep
 *              window AND stale data/cctv.db.backup-* deploy copies beyond 10.
 *
 * Two retention mistakes this is built against, both seen on prod:
 *  - ~50 cctv.db.backup-* files piled up in data/ (the 28 GB incident pattern) because the
 *    deploy script's own prune only runs on deploys that take the DB-backup path.
 *  - The Telegram backup deleting its snapshot after upload left the box with ZERO local
 *    restore points — exactly what a backup is for when Telegram is not configured.
 */

import { readdirSync, existsSync, mkdirSync, statSync, unlinkSync, renameSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createDatabaseSnapshot } from './backupTelegramService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const BACKUP_DIR = join(DATA_DIR, 'backups');

export const LOCAL_BACKUP_KEEP = 14;                    // daily .db.gz snapshots kept
export const DEPLOY_BACKUP_KEEP = 10;                   // cctv.db.backup-* deploy copies kept
export const LOCAL_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_RE = /^cctv_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.db\.gz$/;
const DEPLOY_BACKUP_RE = /^cctv\.db\.backup-\d{8}-\d{6}$/;

function listFiles(dir, re) {
    try {
        return readdirSync(dir)
            .filter((f) => re.test(f))
            .map((f) => {
                const p = join(dir, f);
                return { file: f, path: p, mtimeMs: statSync(p).mtimeMs, bytes: statSync(p).size };
            })
            .sort((a, b) => b.mtimeMs - a.mtimeMs);
    } catch {
        return [];
    }
}

/** Newest-first local snapshots. Injectable dir for tests. */
export function listLocalSnapshots(dir = BACKUP_DIR) {
    return listFiles(dir, SNAPSHOT_RE);
}

/**
 * Delete everything past the keep window, in BOTH retention domains:
 * data/backups/cctv_*.db.gz (this service) and data/cctv.db.backup-* (deploy copies).
 * @returns {number} files deleted
 */
export function pruneLocalSnapshots({ backupDir = BACKUP_DIR, dataDir = DATA_DIR } = {}) {
    let deleted = 0;
    for (const { path } of listFiles(backupDir, SNAPSHOT_RE).slice(LOCAL_BACKUP_KEEP)) {
        unlinkSync(path); deleted += 1;
    }
    for (const { path } of listFiles(dataDir, DEPLOY_BACKUP_RE).slice(DEPLOY_BACKUP_KEEP)) {
        unlinkSync(path); deleted += 1;
    }
    return deleted;
}

/** Due when no snapshot exists or the newest is older than the interval. Injectable for tests. */
export function isLocalBackupDue(now = Date.now(), dir = BACKUP_DIR) {
    const newest = listLocalSnapshots(dir)[0];
    return !newest || now - newest.mtimeMs >= LOCAL_BACKUP_INTERVAL_MS;
}

/** Daily entry point: snapshot → keep the .gz → prune. One stderr line only on failure. */
export async function runLocalBackup({ now = Date.now() } = {}) {
    if (!isLocalBackupDue(now)) {
        return { skipped: true, reason: 'not_due' };
    }
    if (!existsSync(BACKUP_DIR)) {
        mkdirSync(BACKUP_DIR, { recursive: true });
    }
    try {
        const snapshot = await createDatabaseSnapshot();
        const keptPath = join(BACKUP_DIR, snapshot.filename);
        renameSync(snapshot.path, keptPath);
        const pruned = pruneLocalSnapshots();
        console.log(
            `[Backup] Local snapshot kept: ${snapshot.filename} (${(snapshot.bytes / 1048576).toFixed(1)} MB)${pruned ? `, pruned ${pruned} old file(s)` : ''}`
        );
        return { kept: keptPath, bytes: snapshot.bytes, pruned };
    } catch (error) {
        console.error('[Backup] Local DB snapshot FAILED:', error.message);
        return { kept: false, error: error.message };
    }
}

/**
 * Same restart-proof tick as the Telegram backup: hourly check, isLocalBackupDue decides.
 * The local snapshot is owed even when the box reboots 20×/day — that is precisely when
 * you will need it.
 */
export function startLocalBackups({ tickMs = 60 * 60 * 1000, firstTickMs = 4 * 60 * 1000 } = {}) {
    const tick = () => runLocalBackup()
        .catch((error) => console.error('[Backup] Local backup tick failed:', error.message));
    setTimeout(tick, firstTickMs).unref();
    setInterval(tick, tickMs).unref();
    console.log(`[Backup] Local daily snapshot armed (keep ${LOCAL_BACKUP_KEEP}, dir data/backups/)`);
}

export default {
    listLocalSnapshots,
    pruneLocalSnapshots,
    isLocalBackupDue,
    runLocalBackup,
    startLocalBackups,
    LOCAL_BACKUP_KEEP,
    DEPLOY_BACKUP_KEEP,
    LOCAL_BACKUP_INTERVAL_MS,
};
