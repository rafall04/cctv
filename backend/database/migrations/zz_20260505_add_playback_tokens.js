/**
 * Purpose: Add playback token storage for scoped public recording access.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, users and cameras tables.
 * MainFuncs: migration script body.
 * SideEffects: Creates playback_tokens table and indexes.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

console.log('Running migration: zz_20260505_add_playback_tokens');
console.log('Database path:', dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            preset TEXT NOT NULL DEFAULT 'custom',
            scope_type TEXT NOT NULL DEFAULT 'all',
            camera_ids_json TEXT NOT NULL DEFAULT '[]',
            playback_window_hours INTEGER,
            expires_at DATETIME,
            revoked_at DATETIME,
            last_used_at DATETIME,
            use_count INTEGER NOT NULL DEFAULT 0,
            share_template TEXT,
            created_by INTEGER,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_playback_tokens_hash
            ON playback_tokens(token_hash);

        CREATE INDEX IF NOT EXISTS idx_playback_tokens_active
            ON playback_tokens(revoked_at, expires_at);

        CREATE INDEX IF NOT EXISTS idx_playback_tokens_created_at
            ON playback_tokens(created_at);
    `);

    console.log('Playback tokens migration completed');
} catch (error) {
    console.error('Playback tokens migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
