/*
 * Purpose: Schema for the Audio Broadcast feature — upload custom audio clips, group them into
 *          playlists, and play them (on-demand or on a schedule) to camera speakers via the ONVIF
 *          backchannel (see backend/scripts/audio_cast.py + services/audio*Service.js).
 * Caller: database/run-all-migrations.js (and `npm run migrate`).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_clips, audio_playlists, audio_playlist_items, audio_schedules.
 * SideEffects: schema only; additive and idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * NOTES
 *  - A clip's audio bytes live on disk at data/audio/<base_filename>.ulaw (G.711 u-law 16kHz mono,
 *    ready to stream). The row stores only metadata; base_filename is allowlisted before any path use.
 *  - audio_schedules.time_hhmm is WIB (UTC+7) wall-clock; the scheduler compares against WIB, because
 *    prod Node runs in UTC. days_mask is a 7-bit weekday mask, bit0=Sunday..bit6=Saturday (127 = daily).
 *  - camera_ids is a JSON array of camera ids the schedule broadcasts to (only speaker-capable cameras
 *    actually play; the rest are skipped at play time).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio broadcast tables...');

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_clips (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            name          TEXT    NOT NULL,
            base_filename TEXT    NOT NULL UNIQUE,
            duration_sec  REAL    NOT NULL DEFAULT 0,
            source_bytes  INTEGER NOT NULL DEFAULT 0,
            created_by    INTEGER,
            created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_playlists (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            created_at TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_playlist_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER NOT NULL,
            clip_id     INTEGER NOT NULL,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (playlist_id) REFERENCES audio_playlists(id) ON DELETE CASCADE,
            FOREIGN KEY (clip_id)     REFERENCES audio_clips(id)     ON DELETE CASCADE
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_schedules (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT    NOT NULL,
            camera_ids  TEXT    NOT NULL DEFAULT '[]',
            source_type TEXT    NOT NULL,
            source_id   INTEGER NOT NULL,
            time_hhmm   TEXT    NOT NULL,
            days_mask   INTEGER NOT NULL DEFAULT 127,
            loop_count  INTEGER NOT NULL DEFAULT 1,
            enabled     INTEGER NOT NULL DEFAULT 1,
            last_run_at TEXT,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_playlist_items_pl ON audio_playlist_items(playlist_id, sort_order)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_schedules_enabled ON audio_schedules(enabled)');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
