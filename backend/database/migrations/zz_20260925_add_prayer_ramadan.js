/*
 * Purpose: Ramadan layer on the prayer scheduler — the busiest week-of-the-year for a village PA. Adds an
 *          IMSAK announcement (at Subuh−imsak_offset) and a SAHUR wake-up reminder (a chosen time, e.g.
 *          03:00), both active only when Ramadan mode is on (optionally bounded by a date range so it turns
 *          itself off after the month). Buka puasa is already signalled by the Maghrib adzan.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds ramadan_* + sahur_* + imsak_clip_id + last_imsak/last_sahur to audio_prayer_config.
 * SideEffects: schema only; additive + idempotent (per-column PRAGMA guard). ramadan_enabled=0 → OFF.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

const COLUMNS = [
    ['ramadan_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['ramadan_start', 'TEXT'],   // YYYY-MM-DD, optional (empty = no lower bound)
    ['ramadan_end', 'TEXT'],     // YYYY-MM-DD, optional (empty = no upper bound)
    ['imsak_clip_id', 'INTEGER'],
    ['sahur_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['sahur_time', "TEXT NOT NULL DEFAULT '03:00'"],
    ['sahur_clip_id', 'INTEGER'],
    ['last_imsak', 'TEXT'],
    ['last_sahur', 'TEXT'],
];

try {
    console.log('Adding audio_prayer_config Ramadan columns...');
    const cols = db.prepare('PRAGMA table_info(audio_prayer_config)').all().map((c) => c.name);
    if (cols.length === 0) {
        console.log('  ? audio_prayer_config not present, skip');
    } else {
        for (const [name, ddl] of COLUMNS) {
            if (cols.includes(name)) { console.log(`  = ${name} already present`); continue; }
            db.exec(`ALTER TABLE audio_prayer_config ADD COLUMN ${name} ${ddl}`);
            console.log(`  + added ${name}`);
        }
    }
    console.log('Prayer Ramadan migration completed successfully');
} catch (error) {
    console.error('Prayer Ramadan migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
