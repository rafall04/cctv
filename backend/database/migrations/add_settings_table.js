/**
 * Migration: Create settings table for app configuration
 * Run from backend folder: node database/migrations/add_settings_table.js
 * Or from root: node backend/database/migrations/add_settings_table.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path ke database relatif dari lokasi file ini
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

console.log('Creating settings table...');

try {
    // Create settings table
    db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            description TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ Created settings table');

    // Insert default map center (Bojonegoro)
    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, description) 
        VALUES (?, ?, ?)
    `);

    insertSetting.run(
        'map_default_center',
        JSON.stringify({ latitude: -7.1507, longitude: 111.8815, zoom: 13, name: 'Bojonegoro' }),
        'Default center point for map view when "Semua Lokasi" is selected'
    );
    console.log('✓ Added default map center setting');

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
} finally {
    db.close();
}
