/**
 * Migration: add external health mode controls for external streams
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add external health mode...');

const db = new Database(dbPath);

try {
    const tableInfo = db.prepare('PRAGMA table_info(cameras)').all();
    const hasExternalHealthMode = tableInfo.some((column) => column.name === 'external_health_mode');

    if (!hasExternalHealthMode) {
        db.exec("ALTER TABLE cameras ADD COLUMN external_health_mode TEXT NOT NULL DEFAULT 'default'");
        console.log('Added external_health_mode column to cameras table');
    } else {
        console.log('external_health_mode column already exists, skipping');
    }

    db.exec(`
        UPDATE cameras
        SET external_health_mode = CASE
            WHEN external_health_mode IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled') THEN external_health_mode
            ELSE 'default'
        END
    `);

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, description)
        VALUES (?, ?, ?)
    `);

    insertSetting.run(
        'external_mjpeg_health_default',
        'passive_first',
        'Default health mode for external MJPEG cameras'
    );
    insertSetting.run(
        'external_hls_health_default',
        'hybrid_probe',
        'Default health mode for external HLS cameras'
    );

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
