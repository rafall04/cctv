// Purpose: Add global recording segment start-time index for emergency cleanup scans.
// Caller: Backend migration runner after recording_segments exists.
// Deps: better-sqlite3 database file and recording_segments table.
// MainFuncs: migration script body.
// SideEffects: Creates idx_recording_segments_start_id when recording_segments exists.

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
        console.log('recording_segments table does not exist yet; skipping global start index migration');
        process.exit(0);
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_segments_start_id
        ON recording_segments(start_time, id)
    `);
    console.log('Created index idx_recording_segments_start_id');
} finally {
    db.close();
}
