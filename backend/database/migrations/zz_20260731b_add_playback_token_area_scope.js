/*
 * Purpose: Let a playback token be scoped to AREAS, so cameras added to an area later are covered by
 *          tokens issued earlier.
 * Caller: database/run-all-migrations.js (and `npm run migrate`).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: adds playback_tokens.area_ids_json.
 * SideEffects: schema only; additive and idempotent. No existing token changes meaning.
 *
 * WHY A SEPARATE COLUMN INSTEAD OF REUSING camera_ids_json
 * The obvious shortcut — store area ids in camera_ids_json when scope_type='area' — makes one column
 * mean two different things depending on a second column. Every reader would then have to know the
 * scope before it can interpret the ids, and the one reader that forgets grants access to camera ids
 * that are really area ids. On this table a mistake like that is an access-control bug, not a display
 * bug, so the ids get their own column and a wrong read fails closed instead of resolving to the
 * wrong cameras.
 *
 * Existing rows keep area_ids_json NULL, which is exactly right: 'all' and 'selected' tokens do not
 * consult it, and a NULL here can never widen an existing token's reach.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add playback token area scope...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('playback_tokens', 'area_ids_json')) {
        db.exec("ALTER TABLE playback_tokens ADD COLUMN area_ids_json TEXT");
        console.log('✓ playback_tokens.area_ids_json added');
    } else {
        console.log('✓ playback_tokens.area_ids_json already present, skipping');
    }

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
