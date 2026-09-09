/*
 * Purpose: Flexible scheduling for Audio Broadcast — beyond the weekly weekday-mask, support one-off dated
 *          plays and date-bounded recurring runs. Adds schedule_kind + run_date/start_date/end_date to
 *          audio_schedules. All dates are WIB calendar 'YYYY-MM-DD', compared lexically to the WIB dateKey.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds audio_schedules.schedule_kind/run_date/start_date/end_date.
 * SideEffects: schema only; additive + idempotent. schedule_kind DEFAULT 'recurring' keeps every existing
 *   row behaving exactly as before (backward-compatible).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding flexible-scheduling columns to audio_schedules...');
    const cols = db.prepare('PRAGMA table_info(audio_schedules)').all().map((c) => c.name);
    const add = (name, ddl) => {
        if (cols.includes(name)) { console.log(`  = audio_schedules.${name} already present`); }
        else { db.exec(`ALTER TABLE audio_schedules ADD COLUMN ${ddl}`); console.log(`  + added audio_schedules.${name}`); }
    };
    add('schedule_kind', "schedule_kind TEXT NOT NULL DEFAULT 'recurring'"); // 'recurring' | 'once' | 'range'
    add('run_date', 'run_date TEXT');     // 'YYYY-MM-DD' WIB, only for kind='once'
    add('start_date', 'start_date TEXT'); // inclusive lower bound for kind='range' (NULL = open)
    add('end_date', 'end_date TEXT');     // inclusive upper bound for kind='range' (NULL = open)
    console.log('Audio schedule flex migration completed successfully');
} catch (error) {
    console.error('Audio schedule flex migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
