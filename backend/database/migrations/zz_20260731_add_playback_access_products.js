/*
 * Purpose: Add the public playback-access product catalogue, its iPaymu orders, and the
 *          one-per-device trial claim ledger.
 * Caller: database/run-all-migrations.js (and `npm run migrate`).
 * Deps: better-sqlite3, data/cctv.db.
 * MainFuncs: creates playback_products, playback_orders, playback_trial_claims; seeds 4 products.
 * SideEffects: schema only; seeds are INSERT OR IGNORE so re-running never overwrites edited prices.
 *
 * WHY A SEPARATE ORDER TABLE FROM voucher_orders
 * Vouchers gate LIVE access per area and issue a voucher_code. This gates PLAYBACK across all
 * community cameras and issues a playback_token. The money flow is deliberately modelled the same
 * way — pending -> paid with a guarded UPDATE, idempotent issuance keyed on token_id — because that
 * is the part that must never double-charge or double-issue. Sharing one table would force every
 * query in both domains to filter on a discriminator forever; sharing the *pattern* costs nothing.
 *
 * window_hours is HOW FAR BACK a buyer may look, and is entirely independent of validity_days,
 * which is HOW LONG they keep looking. The trial sells 1 hour of depth for 3 days precisely because
 * 1 hour sits inside the 4-hour local retention, so a trial never pulls a file from Telegram.
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

console.log('Starting migration: add playback access products...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            label TEXT NOT NULL,
            description TEXT,
            price_rupiah INTEGER NOT NULL DEFAULT 0,
            window_hours INTEGER NOT NULL,
            validity_days INTEGER NOT NULL,
            is_trial INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_products_enabled ON playback_products(enabled, sort_order)');
    console.log('✓ playback_products ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
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
            token_id INTEGER,
            expires_at TEXT,
            paid_at TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    if (!hasColumn('playback_orders', 'request_ip')) {
        db.exec('ALTER TABLE playback_orders ADD COLUMN request_ip TEXT');
    }
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_gateway_ref ON playback_orders(gateway, gateway_ref)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_reference ON playback_orders(reference)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_status ON playback_orders(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_device ON playback_orders(device_hash)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_ip_created ON playback_orders(request_ip, created_at)');
    console.log('✓ playback_orders ready');

    /*
     * device_hash is the PRIMARY KEY, not merely indexed: "one trial per device" is then enforced by
     * SQLite itself, so a double-tap that races two requests through the service layer still cannot
     * mint two trial tokens. The service checks first for a good error message; this is the guarantee.
     */
    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_trial_claims (
            device_hash TEXT PRIMARY KEY,
            token_id INTEGER,
            request_ip TEXT,
            claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_trial_claims_ip ON playback_trial_claims(request_ip, claimed_at)');
    console.log('✓ playback_trial_claims ready');

    /*
     * INSERT OR IGNORE, never INSERT OR REPLACE: on a re-run this must leave prices the operator
     * edited in the admin panel exactly as they are. Prices below are placeholders in INTEGER rupiah.
     *
     * The 30-day window is honest only once the Telegram archive is 30 days old — before that the
     * depth is however long archiving has been running. The public page says so.
     */
    const seed = db.prepare(`
        INSERT OR IGNORE INTO playback_products
            (key, label, description, price_rupiah, window_hours, validity_days, is_trial, enabled, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `);
    seed.run('trial', 'Coba Gratis', 'Lihat rekaman 1 jam terakhir, berlaku 3 hari. Satu kali per perangkat.', 0, 1, 3, 1, 0);
    seed.run('daily', 'Harian', 'Lihat rekaman sampai 24 jam ke belakang, berlaku 1 hari.', 5000, 24, 1, 0, 1);
    seed.run('weekly', 'Mingguan', 'Lihat rekaman sampai 7 hari ke belakang, berlaku 7 hari.', 25000, 168, 7, 0, 2);
    seed.run('monthly', 'Bulanan', 'Lihat rekaman sampai 30 hari ke belakang, berlaku 30 hari.', 75000, 720, 30, 0, 3);
    console.log('✓ playback_products seeded (existing rows left untouched)');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
