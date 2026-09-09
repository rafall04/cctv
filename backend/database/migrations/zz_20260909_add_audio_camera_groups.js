/*
 * Purpose: Custom MANUAL camera groups for Audio Broadcast — a named bag of arbitrary cameras
 *          (e.g. "Musholla" = cam A, B, C) with NO area basis, so an operator can target them in one
 *          tap instead of re-ticking the same cameras every time. Complements the area presets already
 *          in the picker; this is the "tanpa patokan area" grouping the operator asked for.
 * Caller: database/run-all-migrations.js (npm run migrate).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates audio_camera_groups.
 * SideEffects: schema only; additive + idempotent (CREATE TABLE IF NOT EXISTS).
 *
 * camera_ids is a JSON array of camera ids. Membership is stored as-is (a group may hold a camera that
 * later leaves audio scope); at play time only in-scope, speaker-capable cameras actually sound, and the
 * picker resolves names against the cameras currently in scope.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());
console.log('Starting migration: add audio custom camera groups table...');

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS audio_camera_groups (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            camera_ids TEXT    NOT NULL DEFAULT '[]',
            created_by INTEGER,
            created_at TEXT    NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT
        )
    `);
    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
