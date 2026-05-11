/**
 * Purpose: Create persisted audit rows for admin-triggered Telegram notification diagnostics.
 * Caller: backend/database/run-all-migrations.js.
 * Deps: better-sqlite3 migration connection.
 * MainFuncs: migration script body.
 * SideEffects: Creates notification_diagnostic_runs table and lookup indexes.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    console.log('Running migration: create notification diagnostic runs');

    db.exec(`
        CREATE TABLE IF NOT EXISTS notification_diagnostic_runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER,
            camera_name TEXT NOT NULL,
            event_type TEXT NOT NULL CHECK (event_type IN ('offline', 'online')),
            mode TEXT NOT NULL CHECK (mode IN ('preview', 'drill')),
            success INTEGER NOT NULL DEFAULT 0,
            target_count INTEGER NOT NULL DEFAULT 0,
            sent_count INTEGER NOT NULL DEFAULT 0,
            skipped_reason TEXT,
            error_message TEXT,
            targets_json TEXT NOT NULL DEFAULT '[]',
            routing_json TEXT NOT NULL DEFAULT '{}',
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_notification_diagnostic_runs_created_at
            ON notification_diagnostic_runs(created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_notification_diagnostic_runs_camera_event
            ON notification_diagnostic_runs(camera_id, event_type, created_at DESC);
    `);

    console.log('Notification diagnostic runs migration completed');
} catch (error) {
    console.error('Notification diagnostic runs migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
