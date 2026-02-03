/**
 * Migration: Add latitude and longitude columns to cameras table
 * Run with: node backend/database/migrations/add_coordinates.js
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use hardcoded relative path instead of config to avoid .env dependency
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_coordinates');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

try {
    // Check if columns already exist
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasLatitude = tableInfo.some(col => col.name === 'latitude');
    const hasLongitude = tableInfo.some(col => col.name === 'longitude');

    if (!hasLatitude) {
        db.exec('ALTER TABLE cameras ADD COLUMN latitude REAL');
        console.log('✓ Added latitude column');
    } else {
        console.log('✓ latitude column already exists');
    }

    if (!hasLongitude) {
        db.exec('ALTER TABLE cameras ADD COLUMN longitude REAL');
        console.log('✓ Added longitude column');
    } else {
        console.log('✓ longitude column already exists');
    }

    console.log('\n✅ Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
} finally {
    db.close();
}
