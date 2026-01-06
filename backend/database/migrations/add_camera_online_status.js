/**
 * Migration: Add is_online and last_online_check fields to cameras table
 * For tracking camera online/offline status
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_camera_online_status');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

try {
    // Check if columns exist
    const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
    const hasIsOnline = tableInfo.some(col => col.name === 'is_online');
    const hasLastOnlineCheck = tableInfo.some(col => col.name === 'last_online_check');

    if (!hasIsOnline) {
        db.exec(`ALTER TABLE cameras ADD COLUMN is_online INTEGER DEFAULT 1`);
        console.log('✓ Added is_online column');
    } else {
        console.log('✓ is_online column already exists');
    }

    if (!hasLastOnlineCheck) {
        db.exec(`ALTER TABLE cameras ADD COLUMN last_online_check DATETIME`);
        console.log('✓ Added last_online_check column');
    } else {
        console.log('✓ last_online_check column already exists');
    }

    console.log('✅ Migration completed successfully!');
} catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
} finally {
    db.close();
}
