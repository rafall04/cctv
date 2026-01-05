/**
 * Migration: Add latitude and longitude to areas table
 * Run: node backend/database/migrations/add_area_coordinates.js
 */

import Database from 'better-sqlite3';
import { config } from '../../config/config.js';

const db = new Database(config.database.path);

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
