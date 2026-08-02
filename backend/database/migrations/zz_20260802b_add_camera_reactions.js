// Purpose: Let a visitor say whether a camera is any good, once per device.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates camera_reactions + its index when missing. Idempotent.
//
// One row per (camera, device), not an append-only log of clicks: the primary key IS the
// "one vote per device" rule. Enforcing it in application code instead would mean a race between
// two taps could store two votes, and the count would drift upward with no way to reconcile it.
//
// The vote is a single INTEGER (+1 / -1) rather than two boolean columns so that switching sides
// is an UPDATE of one field, and the aggregate is a plain SUM/COUNT rather than a join.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, '..', '..', 'data', 'cctv.db'));

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_reactions (
            camera_id   INTEGER NOT NULL,
            device_hash TEXT    NOT NULL,
            value       INTEGER NOT NULL,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (camera_id, device_hash)
        )
    `);

    // The only read pattern: totals for one camera, split by side.
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_camera_reactions_camera_value
        ON camera_reactions(camera_id, value)
    `);

    console.log('camera_reactions ready');
} catch (error) {
    console.error('camera_reactions migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
