/*
 * Purpose: Explicit "Titik Speaker" (STB) targets per saved broadcast. v1.4.74 made a device auto-join any
 *          broadcast that reaches its AREA (area-membership). This adds an OPTIONAL explicit device list so an
 *          operator can ALSO target specific speaker nodes from a schedule / emergency preset / soundboard
 *          button — additive to (unioned with) the area-derived devices, never replacing them.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds device_ids (JSON array of device ids) to audio_schedules / audio_emergency_presets /
 *            audio_soundboard. Default '[]' = no explicit device (area-membership still applies).
 * SideEffects: schema only; additive + idempotent (PRAGMA guard).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding explicit device_ids (Titik Speaker targets) columns...');
    const addTo = (table) => {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
        if (cols.length === 0) { console.log(`  ? ${table} not present, skip`); return; }
        if (cols.includes('device_ids')) { console.log(`  = ${table}.device_ids already present`); return; }
        db.exec(`ALTER TABLE ${table} ADD COLUMN device_ids TEXT NOT NULL DEFAULT '[]'`);
        console.log(`  + added ${table}.device_ids`);
    };
    ['audio_schedules', 'audio_emergency_presets', 'audio_soundboard'].forEach(addTo);

    console.log('Device-targets migration completed successfully');
} catch (error) {
    console.error('Device-targets migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
