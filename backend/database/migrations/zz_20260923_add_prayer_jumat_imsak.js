/*
 * Purpose: Two prayer-schedule refinements requested for village/mosque use:
 *   (1) Friday Dzuhur handling — the auto Dzuhur adzan clashes with the mosque's LIVE Jumat adzan every
 *       week; let the operator skip it or play a special clip on Fridays only.
 *   (2) Imsak offset — Imsak = Subuh − N minutes (default 10), so the preview can show Imsak (and Syuruq,
 *       already computed) to match the local Kemenag jadwal, and a future Ramadan mode can announce it.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds jumat_dhuhr_mode / jumat_dhuhr_clip_id / imsak_offset to audio_prayer_config.
 * SideEffects: schema only; additive + idempotent (per-column PRAGMA guard). Defaults keep behaviour
 *              unchanged (jumat_dhuhr_mode='normal').
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

const COLUMNS = [
    ['jumat_dhuhr_mode', "TEXT NOT NULL DEFAULT 'normal'"], // 'normal' | 'skip' | 'custom'
    ['jumat_dhuhr_clip_id', 'INTEGER'],
    ['imsak_offset', 'INTEGER NOT NULL DEFAULT 10'],
];

try {
    console.log('Adding audio_prayer_config Jumat/Imsak columns...');
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
    console.log('Prayer Jumat/Imsak migration completed successfully');
} catch (error) {
    console.error('Prayer Jumat/Imsak migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
