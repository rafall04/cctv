/*
 * Purpose: Per-broadcast VOLUME (loudness) — a gain_db applied at play time (ffmpeg volume + true-peak
 *          limiter in audio_cast.py) so an operator can make a song / qori / adzan / soundboard / emergency
 *          / motion-deter louder or softer WITHOUT clipping (the camera speaker is already at max and clips
 *          are peak-normalised, so a plain gain would distort — a limiter raises perceived loudness cleanly).
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds gain_db to audio_schedules / audio_soundboard / audio_emergency_presets /
 *            audio_prayer_config / audio_motion_arms.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard). Default 0 = as-encoded (unchanged).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding gain_db (volume) columns...');
    const addTo = (table) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (cols.length === 0) { console.log(`  ? ${table} not present, skip`); return; }
        if (cols.includes('gain_db')) { console.log(`  = ${table}.gain_db already present`); return; }
        db.exec(`ALTER TABLE ${table} ADD COLUMN gain_db REAL NOT NULL DEFAULT 0`);
        console.log(`  + added ${table}.gain_db`);
    };
    ['audio_schedules', 'audio_soundboard', 'audio_emergency_presets', 'audio_prayer_config', 'audio_motion_arms'].forEach(addTo);

    console.log('Audio gain migration completed successfully');
} catch (error) {
    console.error('Audio gain migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
