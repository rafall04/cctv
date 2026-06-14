/**
 * Migration: voucher self-serve payment orders (Phase 3 — additive, isolated from billing).
 *
 * voucher_orders tracks ONE online payment (iPaymu QRIS) for a voucher purchase. On confirmation the
 * order issues + activates exactly one voucher_code for the buyer's device. Kept in its OWN table
 * (NOT the billing `payments` table) per the agreed D1 decision — so the donation/voucher money path
 * never touches the subscriber wallet/billing path (prod-safety after the lost-customer incident).
 *
 * Idempotent + self-executing (run by database/run-all-migrations.js, auto-discovered by sort; the
 * trailing 'b' keeps it AFTER zz_20260614_add_voucher_access.js the same day).
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add voucher orders...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            profile_id INTEGER NOT NULL,
            buyer_name TEXT,
            buyer_phone TEXT,
            device_hash TEXT NOT NULL,
            request_ip TEXT,
            gateway TEXT NOT NULL DEFAULT 'ipaymu',
            gateway_ref TEXT,
            reference TEXT,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            qris_payload TEXT,
            code_id INTEGER,
            expires_at TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // request_ip backs a per-IP abuse cap on order creation; guarded ALTER for tables created by an
    // earlier run of this migration (before the column existed).
    if (!hasColumn('voucher_orders', 'request_ip')) {
        db.exec('ALTER TABLE voucher_orders ADD COLUMN request_ip TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_orders_gateway_ref ON voucher_orders(gateway, gateway_ref)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_orders_reference ON voucher_orders(reference)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_orders_status ON voucher_orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_orders_device ON voucher_orders(device_hash)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_orders_ip_created ON voucher_orders(request_ip, created_at)');
    console.log('✓ voucher_orders ready');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
