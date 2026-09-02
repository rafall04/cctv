// Purpose: Let a visitor report a specific problem or event on a specific camera.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates camera_reports + its indexes when missing. Idempotent.
//
// Deliberately NOT a public comment table. Nothing written here is ever rendered on a public
// surface — it goes to the operator's queue and to the Telegram group. That is what makes free
// text safe to accept from anonymous devices: there is no audience to defame to, and nothing to
// take down later.
//
// `occurred_at` is the column that makes this worth more than a complaint box. "Ada kejadian jam
// 14.30 di kamera 16" is a coordinate into the recording archive, which is precisely the thing the
// paid playback packages sell access to.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolveDbPath());

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id   INTEGER NOT NULL,
            device_hash TEXT,
            category    TEXT    NOT NULL,
            message     TEXT,
            -- When the reported thing happened, not when it was reported. Only set for incidents.
            occurred_at TEXT,
            ip_address  TEXT,
            status      TEXT    NOT NULL DEFAULT 'baru',
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    // The queue reads unresolved-first, newest-first; the rate limiter counts one device's recent rows.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_camera_reports_status_created
        ON camera_reports(status, created_at DESC)
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_camera_reports_device_created
        ON camera_reports(device_hash, created_at DESC)
    `);

    console.log('camera_reports ready');
} catch (error) {
    console.error('camera_reports migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
