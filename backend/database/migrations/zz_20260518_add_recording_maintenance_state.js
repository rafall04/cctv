// Purpose: Add recording maintenance state and event history tables.
// Caller: Backend migration runner after recording cleanup hardening migrations.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates recording_maintenance_state and recording_maintenance_events tables plus indexes.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_maintenance_state (
            maintenance_type TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_bytes INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recording_maintenance_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_type TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_bytes INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_recording_maintenance_events_type_created
            ON recording_maintenance_events(maintenance_type, created_at DESC);
    `);

    console.log('Recording maintenance state migration completed');
} finally {
    db.close();
}
