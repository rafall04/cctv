/**
 * Migration: Add is_tunnel field to cameras table
 * This field marks cameras that use tunnel connection (less stable)
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use hardcoded relative path instead of config to avoid .env dependency
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_is_tunnel_field');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Check if column already exists
const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();
const columnExists = tableInfo.some(col => col.name === 'is_tunnel');

if (columnExists) {
    console.log('✓ Column is_tunnel already exists, skipping');
} else {
    db.exec(`ALTER TABLE cameras ADD COLUMN is_tunnel INTEGER DEFAULT 0`);
    console.log('✓ Added is_tunnel column to cameras table');
}

db.close();
console.log('✅ Migration completed successfully!');
