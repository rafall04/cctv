/**
 * Migration: payments.failure_reason — a human-readable reason for a failed top-up.
 *
 * Gateway-rejected charges (e.g. iPaymu "Suspicious buyer") and webhook-reported
 * failures previously left no trace an admin could see. We now persist a
 * status='failed' payment row carrying the gateway's message in this column so the
 * admin Pembayaran tab (and the customer's own history) can explain WHY a top-up
 * failed instead of silently dropping it.
 *
 * Idempotent: ALTER gated on PRAGMA table_info.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add payments.failure_reason...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('payments', 'failure_reason')) {
        db.exec('ALTER TABLE payments ADD COLUMN failure_reason TEXT');
        console.log('✓ payments.failure_reason added');
    } else {
        console.log('  payments.failure_reason already present — skip');
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
