// Purpose: Add filename lookup index for playback stream segment access.
// Caller: Backend migration runner.
// Deps: better-sqlite3 database file.
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
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_segments_camera_filename
        ON recording_segments(camera_id, filename)
    `);
    console.log('Created index idx_recording_segments_camera_filename');
} finally {
    db.close();
}
