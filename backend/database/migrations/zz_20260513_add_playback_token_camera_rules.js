/**
 * Purpose: Add normalized per-camera entitlement rules for playback tokens.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_tokens, cameras.
 * MainFuncs: migration script body.
 * SideEffects: Creates playback_token_camera_rules, indexes, and backfills selected token JSON scopes.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function normalizeCameraIds(value) {
    try {
        const parsed = JSON.parse(value || '[]');
        if (!Array.isArray(parsed)) {
            return [];
        }

        return [...new Set(parsed
            .map((item) => Number.parseInt(item, 10))
            .filter((item) => Number.isInteger(item) && item > 0))];
    } catch {
        return [];
    }
}

console.log('Running migration: zz_20260513_add_playback_token_camera_rules');
console.log('Database path:', dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_token_camera_rules (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token_id INTEGER NOT NULL,
            camera_id INTEGER NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 1,
            playback_window_hours INTEGER,
            expires_at DATETIME,
            note TEXT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (token_id) REFERENCES playback_tokens(id) ON DELETE CASCADE,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE,
            UNIQUE(token_id, camera_id)
        );

        CREATE INDEX IF NOT EXISTS idx_playback_token_camera_rules_token_enabled
            ON playback_token_camera_rules(token_id, enabled, camera_id);

        CREATE INDEX IF NOT EXISTS idx_playback_token_camera_rules_camera_enabled
            ON playback_token_camera_rules(camera_id, enabled, token_id);
    `);

    const selectedTokens = db.prepare(`
        SELECT id, camera_ids_json, playback_window_hours
        FROM playback_tokens
        WHERE scope_type = 'selected'
    `).all();

    const upsertRule = db.prepare(`
        INSERT INTO playback_token_camera_rules
        (token_id, camera_id, enabled, playback_window_hours)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(token_id, camera_id) DO UPDATE SET
            enabled = excluded.enabled,
            playback_window_hours = COALESCE(playback_token_camera_rules.playback_window_hours, excluded.playback_window_hours),
            updated_at = CURRENT_TIMESTAMP
    `);

    const backfill = db.transaction((tokens) => {
        tokens.forEach((token) => {
            normalizeCameraIds(token.camera_ids_json).forEach((cameraId) => {
                upsertRule.run(token.id, cameraId, token.playback_window_hours || null);
            });
        });
    });

    backfill(selectedTokens);

    console.log(`Playback token camera rules migration completed; backfilled ${selectedTokens.length} selected tokens`);
} catch (error) {
    console.error('Playback token camera rules migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
