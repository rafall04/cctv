// Purpose: Index the library list's ordering so the newest-100 page never sorts the whole table.
// Caller: Backend migration runner after telegram_archive_uploads exists.
// Deps: better-sqlite3 database file and telegram_archive_uploads table.
// MainFuncs: migration script body.
// SideEffects: Creates idx_tg_archive_status_uploaded.

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
        console.log('telegram_archive_uploads table does not exist yet; skipping uploaded_at index migration');
        process.exit(0);
    }

    /*
     * listUploads orders by uploaded_at DESC, segment_id DESC under status='ok'. Every existing
     * index orders by camera_id or recorded_at first, so SQLite materialized all ~120k rows into
     * a temp b-tree on EVERY page load — measured 41.6s cold / 0.78s warm on prod (2026-09-21),
     * a synchronous event-loop stall either way. With status as the leading column and the two
     * ORDER BY terms next, SQLite walks the index tail and stops at LIMIT — O(limit), no sort.
     */
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_status_uploaded
        ON telegram_archive_uploads(status, uploaded_at DESC, segment_id DESC)
    `);
    console.log('Created idx_tg_archive_status_uploaded (status, uploaded_at DESC, segment_id DESC)');
} finally {
    db.close();
}
