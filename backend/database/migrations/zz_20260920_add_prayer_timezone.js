/*
 * Purpose: Add a `timezone` (UTC offset in hours) to the adzan config so prayer times are correct
 *          outside WIB too (WITA=+8, WIT=+9). Previously the offset was hard-coded to 7 in
 *          audioPrayerService.cfgToParams, which is only right for WIB; a WITA/WIT village would be an
 *          hour or two off. Location presets (kabupaten/kota) now carry this value.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_prayer_config.timezone (default 7 = WIB).
 * SideEffects: schema only; additive + idempotent (PRAGMA guard). Default 7 keeps existing rows unchanged.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio_prayer_config.timezone...');
    const cols = db.prepare('PRAGMA table_info(audio_prayer_config)').all().map((c) => c.name);
    if (cols.length === 0) {
        console.log('  ? audio_prayer_config not present, skip');
    } else if (cols.includes('timezone')) {
        console.log('  = audio_prayer_config.timezone already present');
    } else {
        db.exec('ALTER TABLE audio_prayer_config ADD COLUMN timezone REAL NOT NULL DEFAULT 7');
        console.log('  + added audio_prayer_config.timezone (default 7 = WIB)');
    }
    console.log('Prayer timezone migration completed successfully');
} catch (error) {
    console.error('Prayer timezone migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
