/*
 * Purpose: Motion -> deterrent-audio "arms" for Audio Broadcast. Per-camera opt-in: when ARMED (and inside
 *          its arm window), an ONVIF motion event plays a deterrent clip on that camera's speaker — with
 *          HEAVY guards (per-camera cooldown + hourly cap) so a motion storm can't machine-gun a fragile
 *          camera. OFF by default; this is the highest-risk feature and needs supervised field testing.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_motion_arms.
 * SideEffects: schema only; additive + idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * arm_until: ISO timestamp the arm auto-disarms at (null = while enabled). cooldown_sec + max_per_hour are
 * the anti-machine-gun guards. onvif_port is the camera's ONVIF HTTP port (usually 80).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio motion arms...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_motion_arms (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id    INTEGER NOT NULL UNIQUE,
            clip_id      INTEGER,
            enabled      INTEGER NOT NULL DEFAULT 0,
            cooldown_sec INTEGER NOT NULL DEFAULT 60,
            max_per_hour INTEGER NOT NULL DEFAULT 6,
            arm_until    TEXT,
            onvif_port   INTEGER NOT NULL DEFAULT 80,
            last_fired   TEXT,
            hour_key     TEXT,
            fired_in_hour INTEGER NOT NULL DEFAULT 0,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        )
    `);

    console.log('Audio motion arms migration completed successfully');
} catch (error) {
    console.error('Audio motion arms migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
