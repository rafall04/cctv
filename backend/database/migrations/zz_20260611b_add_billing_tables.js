/**
 * Migration: prepaid billing tables (wallets, ledger, payments, subscriptions).
 *
 * All money columns are INTEGER rupiah — never float. The wallet ledger
 * (wallet_transactions) is the auditable source of truth; wallets.balance is
 * the materialized current value updated in the same transaction as each
 * ledger insert.
 *
 * Idempotency guards:
 *   - all CREATE TABLE / CREATE INDEX use IF NOT EXISTS;
 *   - daily-charge dedup is enforced at the DB layer via a partial UNIQUE
 *     index on wallet_transactions.reference for type='charge', so a charge
 *     reference like "charge:<subscription_id>:<YYYY-MM-DD>" can only ever
 *     be written once even across racing schedulers/restarts.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add prepaid billing tables...');

const db = new Database(dbPath);

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS wallets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL UNIQUE,
            balance INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ wallets table ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS wallet_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('topup', 'charge', 'refund', 'adjustment')),
            amount INTEGER NOT NULL,
            balance_after INTEGER NOT NULL,
            reference TEXT,
            note TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id, id)');
    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_transactions_charge_ref
        ON wallet_transactions(reference)
        WHERE type = 'charge' AND reference IS NOT NULL
    `);
    console.log('✓ wallet_transactions table ready (charge-reference unique guard)');

    db.exec(`
        CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            gateway TEXT NOT NULL,
            gateway_ref TEXT UNIQUE,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'paid', 'expired', 'failed', 'cancelled')),
            qris_payload TEXT,
            expires_at TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status)');
    console.log('✓ payments table ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS camera_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL UNIQUE,
            user_id INTEGER NOT NULL,
            monthly_price INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended', 'cancelled')),
            activated_at TEXT,
            suspended_at TEXT,
            last_charged_date TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_camera_subscriptions_user ON camera_subscriptions(user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_camera_subscriptions_status ON camera_subscriptions(status)');
    console.log('✓ camera_subscriptions table ready');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
