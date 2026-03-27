/**
 * Migration: add external health mode override to areas and expand health defaults
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add area health override...');

const db = new Database(dbPath);

try {
    const areaTableInfo = db.prepare('PRAGMA table_info(areas)').all();
    const hasAreaOverride = areaTableInfo.some((column) => column.name === 'external_health_mode_override');

    if (!hasAreaOverride) {
        db.exec("ALTER TABLE areas ADD COLUMN external_health_mode_override TEXT NOT NULL DEFAULT 'default'");
        console.log('Added external_health_mode_override column to areas table');
    } else {
        console.log('external_health_mode_override column already exists on areas, skipping');
    }

    db.exec(`
        UPDATE areas
        SET external_health_mode_override = CASE
            WHEN external_health_mode_override IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled')
                THEN external_health_mode_override
            ELSE 'default'
        END
    `);

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, description)
        VALUES (?, ?, ?)
    `);

    insertSetting.run(
        'external_embed_health_default',
        'passive_first',
        'Default health mode for external embed cameras'
    );
    insertSetting.run(
        'external_jsmpeg_health_default',
        'disabled',
        'Default health mode for external JSMPEG cameras'
    );
    insertSetting.run(
        'external_custom_ws_health_default',
        'disabled',
        'Default health mode for external custom WebSocket cameras'
    );

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
