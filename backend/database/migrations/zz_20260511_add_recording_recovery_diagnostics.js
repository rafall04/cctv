// Purpose: Add recording recovery diagnostics for pending/orphan files that cannot enter playback yet.
// Caller: Backend migration runner.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates recording_recovery_diagnostics table and indexes.

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_recovery_diagnostics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            state TEXT NOT NULL,
            reason TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            detected_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            resolved_at DATETIME,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_recovery_active_file
        ON recording_recovery_diagnostics(camera_id, filename, active);

        CREATE INDEX IF NOT EXISTS idx_recording_recovery_camera_state
        ON recording_recovery_diagnostics(camera_id, state, active);

        CREATE INDEX IF NOT EXISTS idx_recording_recovery_active_seen
        ON recording_recovery_diagnostics(active, last_seen_at);
    `);

    console.log('Created recording_recovery_diagnostics table and indexes');
} finally {
    db.close();
}
