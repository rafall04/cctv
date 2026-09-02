// Purpose: Index telegram_archive_uploads for the query the archive playback list actually runs.
// Caller: npm run migrate.
// Deps: better-sqlite3 database file, telegram_archive_uploads table.
// MainFuncs: none (script).
// SideEffects: Creates idx_tg_archive_camera_recorded when missing. Idempotent.
//
// WHY
// ---
// This table is the index into the Telegram archive, and it is the one high-growth
// table that must NOT be pruned — Telegram holds the only copy of anything older
// than the 4-hour local retention, so a deleted row is a recording that can no
// longer be reached. Production adds ~4,800 rows/day, i.e. ~1.75M rows/year, so it
// has to stay fast by being indexed rather than by being emptied.
//
// The existing index is (camera_id, uploaded_at DESC). The query in
// archivedSegmentSourceService is:
//
//   WHERE camera_id = ? AND status='ok' AND file_id IS NOT NULL
//     [AND recorded_at >= ?]  ORDER BY recorded_at ASC  LIMIT ?
//
// It filters and orders by recorded_at (when the footage was made), never by
// uploaded_at (when it reached Telegram). So SQLite could use the old index to find
// the camera's rows but then had to sort every one of them — fine at 12k rows,
// increasingly not at 1.75M. Indexing (camera_id, recorded_at) lets the range scan
// and the ordering both come from the index.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    const table = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_archive_uploads'")
        .get();

    if (!table) {
        console.log('telegram_archive_uploads not present yet; skipping');
    } else {
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_tg_archive_camera_recorded
            ON telegram_archive_uploads(camera_id, recorded_at)
        `);
        console.log('idx_tg_archive_camera_recorded ready');
    }
} catch (error) {
    console.error('archive recorded_at index migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
