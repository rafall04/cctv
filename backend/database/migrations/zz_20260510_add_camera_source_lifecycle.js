/**
 * Purpose: Adds persistent camera source lifecycle metadata and diagnostics.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, cameras table.
 * MainFuncs: columnExists, migration script body.
 * SideEffects: Alters cameras table and creates camera_source_lifecycle_events with supporting indexes.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function columnExists(tableName, columnName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all()
        .some((column) => column.name === columnName);
}

try {
    console.log('Running migration: zz_20260510_add_camera_source_lifecycle');

    if (!columnExists('cameras', 'stream_revision')) {
        db.exec('ALTER TABLE cameras ADD COLUMN stream_revision INTEGER NOT NULL DEFAULT 0');
    }

    if (!columnExists('cameras', 'source_updated_at')) {
        db.exec('ALTER TABLE cameras ADD COLUMN source_updated_at TEXT');
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_source_lifecycle_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            reason TEXT NOT NULL,
            status TEXT NOT NULL,
            source_change_summary_json TEXT NOT NULL DEFAULT '{}',
            result_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_camera_source_lifecycle_events_camera_created
            ON camera_source_lifecycle_events(camera_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_camera_source_lifecycle_events_status_created
            ON camera_source_lifecycle_events(status, created_at DESC);
    `);

    console.log('Migration complete: zz_20260510_add_camera_source_lifecycle');
} catch (error) {
    console.error('Camera source lifecycle migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
