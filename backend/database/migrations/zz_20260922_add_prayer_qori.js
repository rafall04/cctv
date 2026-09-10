/*
 * Purpose: Add "qori/murottal before adzan" to the prayer config — a recitation that plays a chosen number
 *          of minutes BEFORE each prayer's adzan (the common mosque practice of tilawah leading up to the
 *          call to prayer). Per-prayer lead minutes give precise control (0 = no qori for that prayer);
 *          the adzan itself PREEMPTS whatever the qori is still playing, so the handoff is clean.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds qori_* columns + last_qori to audio_prayer_config.
 * SideEffects: schema only; additive + idempotent (per-column PRAGMA guard). Defaults keep the feature OFF
 *              (qori_enabled=0) so existing installs are unchanged until an operator turns it on.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

// Lead defaults to 10 min per prayer so turning the feature on "just works"; the master switch
// (qori_enabled) is OFF by default, so nothing plays until the operator enables + picks a clip.
const COLUMNS = [
    ['qori_enabled', 'INTEGER NOT NULL DEFAULT 0'],
    ['qori_clip_id', 'INTEGER'],
    ['qori_clip_id_fajr', 'INTEGER'],
    ['qori_loop', 'INTEGER NOT NULL DEFAULT 1'],
    ['qori_lead_fajr', 'INTEGER NOT NULL DEFAULT 10'],
    ['qori_lead_dhuhr', 'INTEGER NOT NULL DEFAULT 10'],
    ['qori_lead_asr', 'INTEGER NOT NULL DEFAULT 10'],
    ['qori_lead_maghrib', 'INTEGER NOT NULL DEFAULT 10'],
    ['qori_lead_isha', 'INTEGER NOT NULL DEFAULT 10'],
    ['last_qori', 'TEXT'],
];

try {
    console.log('Adding audio_prayer_config qori (pre-adzan murottal) columns...');
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
    console.log('Prayer qori migration completed successfully');
} catch (error) {
    console.error('Prayer qori migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
