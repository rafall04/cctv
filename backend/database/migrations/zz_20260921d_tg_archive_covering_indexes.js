// Purpose: Covering indexes so archive coverage + summary reads never touch the main table.
// Caller: Backend migration runner after telegram_archive_uploads exists.
// Deps: better-sqlite3 database file and telegram_archive_uploads table.
// MainFuncs: migration script body.
// SideEffects: Rebuilds idx_tg_archive_ok_camera_time as covering; adds idx_tg_archive_status_cam_time
//              and idx_tg_archive_fileid_status.

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
        console.log('telegram_archive_uploads table does not exist yet; skipping archive covering-index migration');
        process.exit(0);
    }

    /*
     * The 20260921c index proved the probe pattern (8.4s -> 9ms for MIN/MAX), but coverage reads
     * recorded_until/duration_seconds too — without them in the index every archive row still costs
     * a main-table lookup (measured: 72s on /api/recordings/1/segments?scope=admin with a cold page
     * cache — a synchronous event-loop stall). Recreate as covering: index-only scan, no row fetches.
     */
    db.exec(`DROP INDEX IF EXISTS idx_tg_archive_ok_camera_time`);
    db.exec(`
        CREATE INDEX idx_tg_archive_ok_camera_time
        ON telegram_archive_uploads(camera_id, recorded_at, recorded_until, duration_seconds)
        WHERE status = 'ok' AND file_id IS NOT NULL
    `);

    /*
     * recordingCoverageRunsService probes (status=? AND camera_id=?) and reads
     * recorded_at/recorded_until/duration_seconds; telegramArchiveLibraryService.getSummary rolls
     * the whole archive up per camera (GROUP BY camera_id, SUM over recorded_at range) and totals
     * file_size. One covering index serves both plans — verified by EXPLAIN on prod (the planner
     * prefers this prefix over the partial index, so the covering columns must live here).
     */
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_status_cam_time
        ON telegram_archive_uploads(status, camera_id, recorded_at, file_size, recorded_until, duration_seconds)
    `);

    /*
     * 'playable' counts rows whose file_id exists — testing that column forces a row lookup per row
     * in any non-covering plan. A partial index whose predicate IS the test makes the count an
     * index-only scan (planner picks it, verified on prod). Columns stay minimal on purpose.
     */
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_fileid_status
        ON telegram_archive_uploads(status)
        WHERE file_id IS NOT NULL
    `);
    console.log('Created covering indexes: ok_camera_time + status_cam_time + fileid_status');
} finally {
    db.close();
}
