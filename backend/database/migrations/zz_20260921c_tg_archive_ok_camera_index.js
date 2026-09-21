// Purpose: Partial index so archive coverage reads are boundary lookups, not table scans.
// Caller: Backend migration runner after telegram_archive_uploads exists.
// Deps: better-sqlite3 database file and telegram_archive_uploads table.
// MainFuncs: migration script body.
// SideEffects: Creates idx_tg_archive_ok_camera_time when missing.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    const archiveTable = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'telegram_archive_uploads'
    `).get();

    if (!archiveTable) {
        console.log('telegram_archive_uploads table does not exist yet; skipping archive coverage index migration');
        process.exit(0);
    }

    /*
     * playbackCoverageService asks MIN/MAX(recorded_at) per camera restricted to usable uploads.
     * Without this index SQLite scans every 'ok' row through a temp b-tree (measured 8–42s on the
     * 120k-row production table — a synchronous event-loop stall on a public endpoint). The partial
     * predicate must match the query's WHERE clause verbatim or SQLite will not use it.
     */
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_ok_camera_time
        ON telegram_archive_uploads(camera_id, recorded_at)
        WHERE status = 'ok' AND file_id IS NOT NULL
    `);
    console.log('Created index idx_tg_archive_ok_camera_time');
} finally {
    db.close();
}
