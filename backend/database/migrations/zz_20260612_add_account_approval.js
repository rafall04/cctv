/**
 * Migration: customer self-registration approval gate.
 *
 * Adds users.account_status:
 *   'approved'  — can log in (DEFAULT, so every EXISTING user — admins, viewers,
 *                 already-active customers, and admin-created customers — stays
 *                 active and is never locked out by this change).
 *   'pending'   — self-registered customer awaiting admin approval; login blocked.
 *   'rejected'  — admin declined the registration; login blocked.
 *
 * Idempotent: the ALTER is gated on PRAGMA table_info; the index uses IF NOT EXISTS.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add users.account_status (registration approval)...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('users', 'account_status')) {
        db.exec("ALTER TABLE users ADD COLUMN account_status TEXT NOT NULL DEFAULT 'approved'");
        console.log('✓ users.account_status added (existing users default to approved)');
    } else {
        console.log('  users.account_status already present — skip');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_users_account_status ON users(account_status)');
    console.log('✓ idx_users_account_status ready');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
