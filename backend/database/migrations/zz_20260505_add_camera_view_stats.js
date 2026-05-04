/**
 * Purpose: Create compact per-camera live view counters for public camera cards.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, cameras table.
 * MainFuncs: migration script body.
 * SideEffects: Creates camera_view_stats table and supporting index if they do not exist.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

console.log('Running migration: zz_20260505_add_camera_view_stats');
console.log('Database path:', dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_view_stats (
            camera_id INTEGER PRIMARY KEY,
            total_live_views INTEGER NOT NULL DEFAULT 0,
            total_watch_seconds INTEGER NOT NULL DEFAULT 0,
            last_viewed_at DATETIME,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (camera_id) REFERENCES cameras(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_camera_view_stats_updated_at
            ON camera_view_stats(updated_at);
    `);

    console.log('Camera view stats migration completed');
} catch (error) {
    console.error('Camera view stats migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
