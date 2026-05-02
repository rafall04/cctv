// Purpose: Add filename lookup index for playback stream segment access.
// Caller: Backend migration runner after recording_segments exists.
// Deps: better-sqlite3 database file and recording_segments table.
// MainFuncs: migration script body.
// SideEffects: Creates idx_recording_segments_camera_filename when missing.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    const recordingSegmentsTable = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_segments'
    `).get();

    if (!recordingSegmentsTable) {
        console.log('recording_segments table does not exist yet; skipping filename index migration');
        process.exit(0);
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_segments_camera_filename
        ON recording_segments(camera_id, filename)
    `);
    console.log('Created index idx_recording_segments_camera_filename');
} finally {
    db.close();
}
