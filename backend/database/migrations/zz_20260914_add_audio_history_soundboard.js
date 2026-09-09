/*
 * Purpose: Two high-value Audio Broadcast pieces:
 *   (1) audio_play_log — one row PER broadcast event (never per-frame) holding the per-camera delivery
 *       receipt (who sounded, who failed + why). Powers "Riwayat" + "Bukti siaran" + "Ulangi terakhir".
 *   (2) audio_soundboard — saved one-tap shortcuts (label + source + target cameras + loop) an operator
 *       fires from a big-button grid on their phone (adzan opener, sirene, routine announcements).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_play_log, audio_soundboard.
 * SideEffects: schema only; additive + idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * One row per play keeps the WAL calm (shared with ~20 recording ffmpeg). results/camera_ids are JSON.
 * "Ulangi" RE-RESOLVES targets against the live broadcast list — it never blindly replays frozen ids.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio history + soundboard tables...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_play_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            source_type  TEXT    NOT NULL,          -- 'clip' | 'playlist'
            source_id    INTEGER NOT NULL,
            source_name  TEXT,
            camera_ids   TEXT    NOT NULL DEFAULT '[]',
            results      TEXT    NOT NULL DEFAULT '[]',
            ok_count     INTEGER NOT NULL DEFAULT 0,
            total_count  INTEGER NOT NULL DEFAULT 0,
            operator_id  INTEGER,
            operator_name TEXT,
            created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_audio_play_log_created ON audio_play_log(created_at DESC)');

    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_soundboard (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            label       TEXT    NOT NULL,
            color       TEXT,
            source_type TEXT    NOT NULL,           -- 'clip' | 'playlist'
            source_id   INTEGER NOT NULL,
            camera_ids  TEXT    NOT NULL DEFAULT '[]',
            loop        INTEGER NOT NULL DEFAULT 1,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            created_by  INTEGER,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    console.log('Audio history + soundboard migration completed successfully');
} catch (error) {
    console.error('Audio history + soundboard migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
