/*
 * Purpose: Emergency broadcast presets for Audio Broadcast — a small set of one-tap "panic" buttons
 *          (banjir/kebakaran/pengumuman darurat) that PREEMPT whatever is playing, bypass quiet hours,
 *          and target an area's supported cameras. Kept as saved presets so the operator taps ONE thing
 *          in a real emergency instead of assembling a broadcast under stress.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_emergency_presets.
 * SideEffects: schema only; additive + idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * target_kind: 'area' (all SUPPORTED cameras in area_id) | 'cameras' (explicit camera_ids JSON). The fan-out
 * is capped at play time so an emergency can't melt the box. Firing always requires an explicit confirm.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio emergency presets...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_emergency_presets (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            label       TEXT    NOT NULL,
            source_type TEXT    NOT NULL DEFAULT 'clip',   -- 'clip' | 'playlist'
            source_id   INTEGER NOT NULL,
            target_kind TEXT    NOT NULL DEFAULT 'area',   -- 'area' | 'cameras'
            area_id     INTEGER,
            camera_ids  TEXT    NOT NULL DEFAULT '[]',
            loop        INTEGER NOT NULL DEFAULT 3,
            created_by  INTEGER,
            created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
        )
    `);

    console.log('Audio emergency presets migration completed successfully');
} catch (error) {
    console.error('Audio emergency presets migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
