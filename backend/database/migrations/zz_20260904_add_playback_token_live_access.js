/*
 * Purpose: Let a playback token ALSO authorize LIVE viewing for the cameras it covers, so one token
 *          handed to a specific person unlocks both live and playback — no separate account or
 *          per-camera stream_access grant needed.
 * Caller: database/run-all-migrations.js (and `npm run migrate`).
 * Deps: better-sqlite3, data/cctv.db, playback_tokens, playback_token_camera_rules.
 * MainFuncs: adds playback_tokens.allow_live and playback_token_camera_rules.allow_live.
 * SideEffects: schema only; additive and idempotent. No existing token changes meaning.
 *
 * TWO LEVELS, ON PURPOSE
 *  - playback_tokens.allow_live (NOT NULL DEFAULT 0): the token-wide default. This covers 'all' and
 *    'area' scopes (which have no per-camera rows) and any 'selected' camera without an override.
 *    Default 0 means every EXISTING token stays playback-only — live is strictly opt-in, so this
 *    migration can never widen an issued token's reach.
 *  - playback_token_camera_rules.allow_live (NULLABLE): a per-camera OVERRIDE. NULL = inherit the
 *    token default; 1 = live allowed for this camera; 0 = live denied for this camera even if the
 *    token default is on. Nullable is the whole point: a rule row that predates this column keeps
 *    NULL and therefore inherits, so the backfill from zz_20260513 is untouched and correct.
 *
 * Playback is never gated by these columns — a camera in a token's scope is always playback-eligible
 * as before. allow_live only ever ADDS the live capability on top; it can never remove playback.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

console.log('Starting migration: add playback token live access...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('playback_tokens', 'allow_live')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN allow_live INTEGER NOT NULL DEFAULT 0');
        console.log('✓ playback_tokens.allow_live added (default 0 = existing tokens stay playback-only)');
    } else {
        console.log('✓ playback_tokens.allow_live already present, skipping');
    }

    if (!hasColumn('playback_token_camera_rules', 'allow_live')) {
        // Nullable, no default: existing rule rows keep NULL = inherit the token-level default.
        db.exec('ALTER TABLE playback_token_camera_rules ADD COLUMN allow_live INTEGER');
        console.log('✓ playback_token_camera_rules.allow_live added (NULL = inherit token default)');
    } else {
        console.log('✓ playback_token_camera_rules.allow_live already present, skipping');
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
