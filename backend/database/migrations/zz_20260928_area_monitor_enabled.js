import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    console.log('Adding monitor_enabled column to areas table...');

    const areaTableInfo = db.prepare('PRAGMA table_info(areas)').all();
    const hasColumn = areaTableInfo.some((column) => column.name === 'monitor_enabled');

    if (!hasColumn) {
        // OPT-IN by default (0): /monitor is a pos-ronda surface, not a general
        // directory — an area only joins the picker when the operator enables it.
        db.exec('ALTER TABLE areas ADD COLUMN monitor_enabled INTEGER NOT NULL DEFAULT 0');
        console.log('Added monitor_enabled column to areas table');
    } else {
        console.log('monitor_enabled column already exists on areas, skipping');
    }

    // Reference-deployment default: the operator's own villages. Slugs that do not
    // exist on another install simply match zero rows — safe to run anywhere.
    const seeded = db.prepare(`
        UPDATE areas SET monitor_enabled = 1
        WHERE COALESCE(slug, LOWER(REPLACE(name, ' ', '-'))) IN (
            'ds-dander', 'ds-tanjungharjo', 'kec-bojonegoro-dan-sekitarnya'
        )
    `).run();
    console.log(`monitor_enabled seeded ON for ${seeded.changes} area(s)`);

    console.log('Area monitor flag migration completed successfully');
} catch (error) {
    console.error('Area monitor flag migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
