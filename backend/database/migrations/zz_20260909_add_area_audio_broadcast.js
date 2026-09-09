/*
 * Purpose: Per-area "audio broadcast enabled" allowlist flag — scopes which areas' cameras/speaker-nodes
 *          can be audio-broadcast targets. DEFAULT 0 is load-bearing: every imported/remote area (incl.
 *          the ~394 Surabaya 36.66.208.x internal cameras) is OFF until an admin turns a local village
 *          area (Dander, Tanjungharjo, ...) ON. Deterministic scope — beats any IP heuristic.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds areas.audio_broadcast_enabled.
 * SideEffects: schema only; additive + idempotent (PRAGMA table_info guard). NOT added to
 *   PUBLIC_AREA_COLUMNS — this is an operations flag, never published to a public surface.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    console.log('Adding audio_broadcast_enabled column to areas table...');
    const has = db.prepare('PRAGMA table_info(areas)').all().some((c) => c.name === 'audio_broadcast_enabled');
    if (!has) {
        db.exec('ALTER TABLE areas ADD COLUMN audio_broadcast_enabled INTEGER NOT NULL DEFAULT 0');
        console.log('  + added areas.audio_broadcast_enabled (DEFAULT 0)');
    } else {
        console.log('  = areas.audio_broadcast_enabled already present');
    }
    console.log('Area audio-broadcast flag migration completed successfully');
} catch (error) {
    console.error('Area audio-broadcast flag migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
