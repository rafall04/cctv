/**
 * Migration: Add status field to cameras table
 * Status: 'active' | 'maintenance' | 'offline'
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Resolve database path relative to this migration file
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Migration: add_camera_status');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

try {
    // Check if column already exists
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasStatus = tableInfo.some(col => col.name === 'status');

    if (!hasStatus) {
        console.log('Adding status column to cameras table...');
        db.exec(`ALTER TABLE cameras ADD COLUMN status TEXT DEFAULT 'active'`);
        console.log('✓ status column added successfully');
    } else {
        console.log('✓ status column already exists');
    }

    console.log('Migration completed successfully!');
} catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
} finally {
    db.close();
}
