// Purpose: Reconcile duplicate recording segments and enforce unique segment identity per camera.
// Caller: Backend migration runner after recording_segments table exists.
// Deps: better-sqlite3 database file and existing recording_segments schema.
// MainFuncs: deduplicate existing rows, create unique index on camera_id + filename.
// SideEffects: Deletes duplicate rows while preserving the newest row; creates a unique index.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_segments'
    `).get();

    if (!table) {
        throw new Error('recording_segments table does not exist yet');
    }

    db.exec(`
        DELETE FROM recording_segments
        WHERE id IN (
            SELECT loser.id
            FROM recording_segments loser
            JOIN recording_segments winner
              ON winner.camera_id = loser.camera_id
             AND winner.filename = loser.filename
             AND (
                    winner.created_at > loser.created_at
                 OR (winner.created_at = loser.created_at AND winner.id > loser.id)
             )
        )
    `);

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_segments_camera_filename_unique
        ON recording_segments(camera_id, filename)
    `);

    console.log('Created unique index idx_recording_segments_camera_filename_unique');
} finally {
    db.close();
}
