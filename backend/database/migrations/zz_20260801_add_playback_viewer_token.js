/**
 * Purpose: Record WHICH playback token unlocked a viewer session.
 * Caller: npm run migrate.
 * Deps: better-sqlite3, data/cctv.db.
 * SideEffects: Adds two nullable columns + one index to playback_viewer_sessions.
 *
 * WHY
 * playback_viewer_sessions already stored the segment, the footage time, the device and how long
 * each view lasted — everything except who it was for. It knew `playback_access_mode`, but the
 * frontend only ever had two scopes (public_preview, admin_full), so a token holder watching was
 * filed as an anonymous public preview. On production that left 143 sessions split 9 admin /
 * 134 "public" / 0 token, while the token audit log plainly showed token holders watching.
 *
 * With these columns Playback Analytics can answer "what did this token holder watch, and for how
 * long" — the question that page exists for.
 *
 * SAFETY
 * Purely additive. ADD COLUMN without a default rewrites no existing row, and both columns are
 * nullable, so rows already there stay valid and read as "no token" — which is the truth for admin
 * and genuinely anonymous views. Nothing is backfilled: past sessions cannot be attributed after
 * the fact, and inventing a token for them would be worse than leaving them blank.
 *
 * The label is COPIED rather than joined, so the history of what was watched survives the token
 * being deleted — the same reason the audit log keeps its rows via ON DELETE SET NULL.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add playback viewer token columns...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

function tableExists(table) {
    return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
}

try {
    db.exec('BEGIN');

    // Both tables: the live session AND the history row it is copied into when it ends. Adding the
    // column to only one would leave the analytics history permanently blind to tokens.
    for (const table of ['playback_viewer_sessions', 'playback_viewer_session_history']) {
        if (!tableExists(table)) {
            console.log(`✓ ${table} not present yet, skipping`);
            continue;
        }

        for (const column of [['token_id', 'INTEGER'], ['token_label', 'TEXT']]) {
            if (!hasColumn(table, column[0])) {
                db.exec(`ALTER TABLE ${table} ADD COLUMN ${column[0]} ${column[1]}`);
                console.log(`✓ ${table}.${column[0]} added`);
            } else {
                console.log(`✓ ${table}.${column[0]} already present, skipping`);
            }
        }

        db.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_token ON ${table}(token_id)`);
    }
    console.log('✓ token indexes ready');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
