/**
 * Migration: Add feedbacks table
 * Run this to add the feedbacks table to existing database
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Use hardcoded relative path instead of config to avoid .env dependency
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Running migration: add_feedbacks_table');
console.log('Database path:', dbPath);

const db = new Database(dbPath);

// Check if table already exists
const tableExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' AND name='feedbacks'
`).get();

if (tableExists) {
    console.log('✓ Table feedbacks already exists, skipping');
} else {
    db.exec(`
        CREATE TABLE feedbacks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            email TEXT,
            message TEXT NOT NULL,
            status TEXT DEFAULT 'unread',
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ Created feedbacks table');
}

// Create index for faster queries
const indexExists = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='index' AND name='idx_feedbacks_status'
`).get();

if (!indexExists) {
    db.exec(`CREATE INDEX idx_feedbacks_status ON feedbacks(status)`);
    console.log('✓ Created index idx_feedbacks_status');
}

const indexCreatedAt = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='index' AND name='idx_feedbacks_created_at'
`).get();

if (!indexCreatedAt) {
    db.exec(`CREATE INDEX idx_feedbacks_created_at ON feedbacks(created_at DESC)`);
    console.log('✓ Created index idx_feedbacks_created_at');
}

db.close();
console.log('✅ Migration completed successfully!');
