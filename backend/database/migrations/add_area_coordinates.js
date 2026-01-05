/**
 * Migration: Add latitude and longitude to areas table
 * Run from backend folder: node database/migrations/add_area_coordinates.js
 * Or from root: node backend/database/migrations/add_area_coordinates.js
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

console.log('Adding coordinates columns to areas table...');

try {
    // Check if columns exist
    const tableInfo = db.prepare("PRAGMA table_info(areas)").all();
    const hasLatitude = tableInfo.some(col => col.name === 'latitude');
    const hasLongitude = tableInfo.some(col => col.name === 'longitude');

    if (!hasLatitude) {
        db.exec('ALTER TABLE areas ADD COLUMN latitude REAL');
        console.log('✓ Added latitude column');
    } else {
        console.log('- latitude column already exists');
    }

    if (!hasLongitude) {
        db.exec('ALTER TABLE areas ADD COLUMN longitude REAL');
        console.log('✓ Added longitude column');
    } else {
        console.log('- longitude column already exists');
    }

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
} finally {
    db.close();
}
