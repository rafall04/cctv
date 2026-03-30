import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

try {
    console.log('Adding show_on_grid_default column to areas table...');

    const areaTableInfo = db.prepare('PRAGMA table_info(areas)').all();
    const hasColumn = areaTableInfo.some((column) => column.name === 'show_on_grid_default');

    if (!hasColumn) {
        db.exec('ALTER TABLE areas ADD COLUMN show_on_grid_default INTEGER NOT NULL DEFAULT 1');
        console.log('Added show_on_grid_default column to areas table');
    } else {
        console.log('show_on_grid_default column already exists on areas, skipping');
    }

    db.exec(`
        UPDATE areas
        SET show_on_grid_default = CASE
            WHEN show_on_grid_default IN (0, 1) THEN show_on_grid_default
            ELSE 1
        END
    `);

    console.log('Area grid default visibility migration completed successfully');
} catch (error) {
    console.error('Area grid default visibility migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
