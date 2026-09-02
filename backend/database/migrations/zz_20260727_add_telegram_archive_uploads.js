// Purpose: Give the Telegram archive uploader a table in the APPLICATION database, so the admin
//          surface reads its own data instead of opening the sidecar's state.db across processes.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates telegram_archive_uploads + its indexes when missing. Idempotent.
//
// Why this exists: the uploader is deliberately a separate process (see sidecar/.module_map.md),
// but its DATA should not be foreign. Until now backend/services/telegramArchiveService.js opened
// /opt/tg-archive/state.db read-only — a cross-process read that is fragile while the sidecar is
// mid-WAL-write (observed at 4 MB on prod) and impossible to join against cameras/areas in SQL.
//
// `file_id` is the column that makes a web archive possible at all: Bot API cannot fetch a file
// from a message_id, getFile needs a file_id, and one file_id serves a segment however many groups
// it was copied into.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS telegram_archive_uploads (
            segment_id      INTEGER PRIMARY KEY,
            camera_id       INTEGER NOT NULL,
            filename        TEXT    NOT NULL,
            file_size       INTEGER NOT NULL DEFAULT 0,
            status          TEXT    NOT NULL,
            detail          TEXT,
            -- JSON array of {chatId,label,messageId,fileId?}. The first entry is the real upload;
            -- the rest are copyMessage mirrors that reuse the same stored file.
            targets         TEXT,
            -- Denormalised from targets[0] so the archive list can filter and stream without
            -- parsing JSON per row. NULL for rows written before the uploader recorded it.
            file_id         TEXT,
            recorded_at     TEXT,
            -- A CCTV segment is a RANGE, not an instant. Storing only the start left the page
            -- saying "19.32" when what an operator needs to know is "19.32 -> 19.42, 10 minutes".
            recorded_until  TEXT,
            duration_seconds INTEGER,
            uploaded_at     TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // Newest-first per camera is the only access pattern the archive page has.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_camera_time
        ON telegram_archive_uploads(camera_id, uploaded_at DESC)
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tg_archive_status
        ON telegram_archive_uploads(status)
    `);

    console.log('telegram_archive_uploads ready');
} catch (error) {
    console.error('telegram_archive_uploads migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
