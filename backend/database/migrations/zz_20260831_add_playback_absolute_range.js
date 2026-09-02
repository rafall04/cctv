/**
 * Purpose: Add absolute date-range depth (playback_from / playback_to) to playback tokens — an
 *          alternative to the rolling playback_window_hours, so a token can be cut to an exact span
 *          (e.g. "footage 1–5 Aug 2026 only"). Both nullable; when set they win over the window.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_tokens.
 * MainFuncs: migration script body.
 * SideEffects: Adds two nullable DATETIME columns to playback_tokens (idempotent).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = resolveDbPath();
const db = new Database(dbPath);

console.log('Running migration: zz_20260831_add_playback_absolute_range');
console.log('Database path:', dbPath);

try {
    const columns = db.prepare('PRAGMA table_info(playback_tokens)').all().map((column) => column.name);

    for (const name of ['playback_from', 'playback_to']) {
        if (columns.includes(name)) {
            console.log(`  = playback_tokens.${name} already present`);
        } else {
            db.exec(`ALTER TABLE playback_tokens ADD COLUMN ${name} DATETIME`);
            console.log(`  + added playback_tokens.${name}`);
        }
    }

    console.log('Migration complete: zz_20260831_add_playback_absolute_range');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
