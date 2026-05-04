/*
Purpose: Add per-camera thumbnail capture strategy metadata.
Caller: backend/database/run-all-migrations.js and migration operators.
Deps: better-sqlite3 and backend/data/cctv.db.
MainFuncs: migration bootstrap.
SideEffects: Alters cameras table and normalizes invalid thumbnail strategy values.
*/

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('[Migration] Adding camera thumbnail strategy...');

const db = new Database(dbPath);

try {
    const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
    const hasThumbnailStrategy = tableInfo.some((col) => col.name === 'thumbnail_strategy');

    if (!hasThumbnailStrategy) {
        db.exec("ALTER TABLE cameras ADD COLUMN thumbnail_strategy TEXT NOT NULL DEFAULT 'default'");
        console.log('[Migration] Added cameras.thumbnail_strategy');
    } else {
        console.log('[Migration] cameras.thumbnail_strategy already exists');
    }

    db.exec(`
        UPDATE cameras
        SET thumbnail_strategy = 'default'
        WHERE thumbnail_strategy IS NULL
           OR thumbnail_strategy NOT IN ('default', 'direct_rtsp', 'hls_fallback', 'hls_only')
    `);

    console.log('[Migration] Camera thumbnail strategy migration completed');
} catch (error) {
    console.error('[Migration] Camera thumbnail strategy migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
