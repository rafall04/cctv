/**
 * Migration: add coverage scope and viewport zoom override to areas
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add area coverage scope...');

const db = new Database(dbPath);

try {
    const areaTableInfo = db.prepare('PRAGMA table_info(areas)').all();
    const hasCoverageScope = areaTableInfo.some((column) => column.name === 'coverage_scope');
    const hasViewportZoomOverride = areaTableInfo.some((column) => column.name === 'viewport_zoom_override');

    if (!hasCoverageScope) {
        db.exec("ALTER TABLE areas ADD COLUMN coverage_scope TEXT NOT NULL DEFAULT 'default'");
        console.log('Added coverage_scope column to areas table');
    } else {
        console.log('coverage_scope column already exists on areas, skipping');
    }

    if (!hasViewportZoomOverride) {
        db.exec('ALTER TABLE areas ADD COLUMN viewport_zoom_override INTEGER');
        console.log('Added viewport_zoom_override column to areas table');
    } else {
        console.log('viewport_zoom_override column already exists on areas, skipping');
    }

    db.exec(`
        UPDATE areas
        SET coverage_scope = CASE
            WHEN coverage_scope IN ('default', 'site_point', 'rt_rw', 'kelurahan_desa', 'kecamatan', 'kabupaten_kota', 'regional', 'custom')
                THEN coverage_scope
            ELSE 'default'
        END
    `);

    db.exec(`
        UPDATE areas
        SET viewport_zoom_override = CASE
            WHEN viewport_zoom_override BETWEEN 1 AND 20
                THEN viewport_zoom_override
            ELSE NULL
        END
    `);

    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
