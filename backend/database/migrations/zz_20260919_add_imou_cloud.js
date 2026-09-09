/*
 * Purpose: IMOU Cloud (Easy4ip OpenAPI) integration — trigger the camera's built-in SIREN / white-light
 *          (active deterrence), which is far louder than the ONVIF two-way-talk backchannel. Stores the
 *          OpenAPI app credentials (single row) + a per-camera IMOU device serial (SN) so we know which
 *          device to trigger. The siren is fired via cloud (POST setDeviceCameraStatus enableType=siren).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_imou_config (+ seed row); adds cameras.imou_sn.
 * SideEffects: schema only; additive + idempotent.
 *
 * app_secret is an API credential (NOT the camera admin password); it stays server-side and is never
 * returned to the frontend. base_url defaults to the official OpenAPI host.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add IMOU cloud config...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_imou_config (
            id         INTEGER PRIMARY KEY CHECK (id = 1),
            app_id     TEXT,
            app_secret TEXT,
            base_url   TEXT NOT NULL DEFAULT 'https://openapi.easy4ip.com/openapi',
            updated_at TEXT
        )
    `);
    db.prepare('INSERT OR IGNORE INTO audio_imou_config (id) VALUES (1)').run();

    const cols = db.prepare('PRAGMA table_info(cameras)').all().map((c) => c.name);
    if (!cols.includes('imou_sn')) {
        db.exec('ALTER TABLE cameras ADD COLUMN imou_sn TEXT');
        console.log('  + added cameras.imou_sn');
    } else {
        console.log('  = cameras.imou_sn already present');
    }

    console.log('IMOU cloud migration completed successfully');
} catch (error) {
    console.error('IMOU cloud migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
