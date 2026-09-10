/*
 * Purpose: "Titik Speaker" — network speaker nodes (STB/Armbian + Class-D amp + TOA horn) that receive
 *          broadcasts over the LAN, covering spots where no camera has a speaker. Each node authenticates
 *          with its own device TOKEN (not an admin JWT) and PULLS commands (short-poll), so it works behind
 *          NAT and degrades gracefully offline — the same "pull" model as the roadmap's axis B.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_devices + audio_device_commands (a tiny per-device play/stop queue).
 * SideEffects: schema only; additive + idempotent (CREATE TABLE IF NOT EXISTS).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio devices (Titik Speaker)...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_devices (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            area_id    INTEGER,
            token      TEXT    NOT NULL UNIQUE,
            enabled    INTEGER NOT NULL DEFAULT 1,
            last_seen  TEXT,
            last_ip    TEXT,
            created_at TEXT    DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS audio_device_commands (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id  INTEGER NOT NULL,
            command    TEXT    NOT NULL,           -- 'play' | 'stop'
            clip_id    INTEGER,
            loop       INTEGER NOT NULL DEFAULT 1,
            created_at TEXT    DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audio_device_commands_dev ON audio_device_commands(device_id, id);
    `);
    console.log('Audio devices migration completed successfully');
} catch (error) {
    console.error('Audio devices migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
