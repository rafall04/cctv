/**
 * Purpose: Add repeat-share keys and audit trail for playback token operations.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_tokens, cameras, users tables.
 * MainFuncs: migration script body.
 * SideEffects: Alters playback_tokens and creates playback_token_audit_logs with indexes.
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

console.log('Running migration: zz_20260505_add_playback_token_audit_and_share_keys');
console.log('Database path:', dbPath);

try {
    if (!columnExists('playback_tokens', 'share_key_hash')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN share_key_hash TEXT');
    }

    if (!columnExists('playback_tokens', 'share_key_prefix')) {
        db.exec('ALTER TABLE playback_tokens ADD COLUMN share_key_prefix TEXT');
    }

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playback_tokens_share_key_hash
            ON playback_tokens(share_key_hash)
            WHERE share_key_hash IS NOT NULL;

        CREATE TABLE IF NOT EXISTS playback_token_audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER,
            event_type TEXT NOT NULL,
            camera_id INTEGER,
            actor_user_id INTEGER,
            ip_address TEXT,
            user_agent TEXT,
            detail_json TEXT NOT NULL DEFAULT '{}',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE SET NULL,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE SET NULL,
            FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_playback_token_audit_token_created
            ON playback_token_audit_logs(token_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_playback_token_audit_camera_created
            ON playback_token_audit_logs(camera_id, created_at DESC);

        CREATE INDEX IF NOT EXISTS idx_playback_token_audit_event_created
            ON playback_token_audit_logs(event_type, created_at DESC);
    `);

    console.log('Playback token audit/share-key migration completed');
} catch (error) {
    console.error('Playback token audit/share-key migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
