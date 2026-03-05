/**
 * Migration: Add external stream support to cameras table
 * Adds stream_source and external_hls_url columns for third-party CCTV streams
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_external_stream');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

const tableInfo = db.prepare("PRAGMA table_info(cameras)").all();

// Add stream_source column
const hasStreamSource = tableInfo.some(col => col.name === 'stream_source');
if (hasStreamSource) {
    console.log('✓ Column stream_source already exists, skipping');
} else {
    db.exec(`ALTER TABLE cameras ADD COLUMN stream_source TEXT NOT NULL DEFAULT 'internal'`);
    console.log('✓ Added stream_source column to cameras table');
}

// Add external_hls_url column
const hasExternalUrl = tableInfo.some(col => col.name === 'external_hls_url');
if (hasExternalUrl) {
    console.log('✓ Column external_hls_url already exists, skipping');
} else {
    db.exec(`ALTER TABLE cameras ADD COLUMN external_hls_url TEXT`);
    console.log('✓ Added external_hls_url column to cameras table');
}

db.close();
console.log('✅ Migration completed successfully!');
