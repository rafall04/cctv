/**
 * Migration: add camera_telegram_alert_state table.
 *
 * Persists the per-camera Telegram alert-confirmation state so a backend
 * restart (or a camera stream refresh) no longer loses an in-flight DOWN
 * alert. Pure CREATE TABLE IF NOT EXISTS — creates a new empty table and
 * touches no existing table or data.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add camera_telegram_alert_state table...');

const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_telegram_alert_state (
            camera_id INTEGER PRIMARY KEY,
            alert_state TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ camera_telegram_alert_state table ready');
    console.log('Migration completed successfully');
} catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
