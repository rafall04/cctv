/**
 * Migration: cameras.is_public — lets a customer publish their (paid) subscriber camera
 * onto the public community hub.
 *
 * Default 0 (private). Public visibility is `is_public = 1 AND billing_status = 'active'`
 * for subscriber cameras (a suspended camera drops off public automatically). Community
 * cameras are public regardless of this flag; owner_private never becomes public.
 *
 * Idempotent: ALTER gated on PRAGMA table_info.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add cameras.is_public...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('cameras', 'is_public')) {
        db.exec('ALTER TABLE cameras ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0');
        console.log('✓ cameras.is_public added');
    } else {
        console.log('  cameras.is_public already present — skip');
    }

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
