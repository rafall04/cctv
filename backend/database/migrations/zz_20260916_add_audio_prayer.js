/*
 * Purpose: Config for automatic Adzan (prayer-time) broadcasts — a single-row table holding the village
 *          location, calculation params (Kemenag defaults), per-prayer enable/offset, the adzan clip, and
 *          the target cameras. The scheduler computes today's prayer times locally (no external API) and
 *          plays the adzan at each enabled prayer, bypassing quiet hours.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_prayer_config + seeds the single row (id=1, disabled).
 * SideEffects: schema + one seed row; additive + idempotent.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio prayer (adzan) config...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_prayer_config (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            enabled      INTEGER NOT NULL DEFAULT 0,
            latitude     REAL    NOT NULL DEFAULT 0,
            longitude    REAL    NOT NULL DEFAULT 0,
            elevation    REAL    NOT NULL DEFAULT 0,
            fajr_angle   REAL    NOT NULL DEFAULT 20,
            isha_angle   REAL    NOT NULL DEFAULT 18,
            asr_factor   REAL    NOT NULL DEFAULT 1,
            ikhtiyati    INTEGER NOT NULL DEFAULT 2,
            offset_fajr    INTEGER NOT NULL DEFAULT 0,
            offset_dhuhr   INTEGER NOT NULL DEFAULT 0,
            offset_asr     INTEGER NOT NULL DEFAULT 0,
            offset_maghrib INTEGER NOT NULL DEFAULT 0,
            offset_isha    INTEGER NOT NULL DEFAULT 0,
            enable_fajr    INTEGER NOT NULL DEFAULT 1,
            enable_dhuhr   INTEGER NOT NULL DEFAULT 1,
            enable_asr     INTEGER NOT NULL DEFAULT 1,
            enable_maghrib INTEGER NOT NULL DEFAULT 1,
            enable_isha    INTEGER NOT NULL DEFAULT 1,
            clip_id      INTEGER,
            clip_id_fajr INTEGER,
            target_kind  TEXT    NOT NULL DEFAULT 'area',
            area_id      INTEGER,
            camera_ids   TEXT    NOT NULL DEFAULT '[]',
            loop         INTEGER NOT NULL DEFAULT 1,
            last_fired   TEXT
        )
    `);
    db.prepare('INSERT OR IGNORE INTO audio_prayer_config (id) VALUES (1)').run();

    console.log('Audio prayer config migration completed successfully');
} catch (error) {
    console.error('Audio prayer config migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
