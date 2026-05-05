/**
 * Purpose: Add per-token playback session policy and active session tracking.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_tokens table.
 * MainFuncs: migration script body.
 * SideEffects: Alters playback_tokens and creates playback_token_sessions with active-session indexes.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function columnExists(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

console.log('Running migration: zz_20260505c_add_playback_token_sessions');
console.log('Database path:', dbPath);

try {
    if (!columnExists('playback_tokens', 'max_active_sessions')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN max_active_sessions INTEGER');
    }

    if (!columnExists('playback_tokens', 'session_limit_mode')) {
        db.exec("ALTER TABLE playback_tokens ADD COLUMN session_limit_mode TEXT NOT NULL DEFAULT 'unlimited'");
    }

    if (!columnExists('playback_tokens', 'session_timeout_seconds')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN session_timeout_seconds INTEGER NOT NULL DEFAULT 60');
    }

    if (!columnExists('playback_tokens', 'client_note')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN client_note TEXT');
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_token_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER NOT NULL,
            session_id_hash TEXT NOT NULL UNIQUE,
            client_id_hash TEXT,
            ip_address TEXT,
            user_agent TEXT,
            activated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at DATETIME NOT NULL,
            ended_at DATETIME,
            end_reason TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_playback_token_sessions_token_active
            ON playback_token_sessions(token_id, ended_at, expires_at, last_seen_at);

        CREATE INDEX IF NOT EXISTS idx_playback_token_sessions_last_seen
            ON playback_token_sessions(last_seen_at);
    `);

    console.log('Playback token sessions migration completed');
} catch (error) {
    console.error('Playback token sessions migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
