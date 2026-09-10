/*
 * Purpose: Let an emergency preset ALSO raise the camera's built-in IMOU siren, so a real "panic" is ONE
 *          tap (audio broadcast + siren) instead of firing the preset and then toggling each siren by hand.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_emergency_presets.siren.
 * SideEffects: schema only; additive + idempotent (PRAGMA guard). Default 0 = existing presets unchanged.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio_emergency_presets.siren...');
    const cols = db.prepare('PRAGMA table_info(audio_emergency_presets)').all().map((c) => c.name);
    if (cols.length === 0) {
        console.log('  ? audio_emergency_presets not present, skip');
    } else if (cols.includes('siren')) {
        console.log('  = audio_emergency_presets.siren already present');
    } else {
        db.exec('ALTER TABLE audio_emergency_presets ADD COLUMN siren INTEGER NOT NULL DEFAULT 0');
        console.log('  + added audio_emergency_presets.siren');
    }
    console.log('Emergency siren migration completed successfully');
} catch (error) {
    console.error('Emergency siren migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
