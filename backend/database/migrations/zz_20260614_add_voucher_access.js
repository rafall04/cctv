/**
 * Migration: voucher-gated area access (Phase 1 — schema only, additive, feature OFF by default).
 *
 * Adds the "profil voucher" model (à la Mikrotik hotspot profiles + vouchers) that lets a
 * deployment restrict PUBLIC live CCTV per-area behind a time-limited voucher code:
 *   - voucher_profiles       : template (durasi/masa-aktif, harga, maks-pemakai-per-kode, masa hangus)
 *   - voucher_profile_areas  : bundle area (many-to-many) yang dibuka satu profil
 *   - voucher_codes          : satu kode (unused/active/expired/revoked), pembeli nama+HP, expiry
 *   - voucher_redemptions    : satu baris per (kode, perangkat) — enforce maks pemakai + audit
 *   - areas.is_access_gated  : penanda EKSPLISIT area "berbayar" (default 0 — tidak ada yang berubah)
 *
 * The global feature flag lives in `settings` key `voucher_access_enabled`; it is intentionally
 * NOT seeded here — a missing row reads as OFF (voucherService.isFeatureEnabled defaults false),
 * so existing deployments behave identically until an admin turns it on.
 *
 * Idempotent: CREATE ... IF NOT EXISTS; the ALTER is gated on PRAGMA table_info. Self-executing
 * (run as a standalone `node` process by the ACTIVE runner database/run-all-migrations.js — hyphenated;
 * it auto-discovers migrations by sort. NOT the orphaned legacy migrations/run_all_migrations.js).
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add voucher area access...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            duration_minutes INTEGER NOT NULL DEFAULT 1440,
            max_uses_per_code INTEGER NOT NULL DEFAULT 1,
            price INTEGER NOT NULL DEFAULT 0,
            code_validity_days INTEGER,
            online_purchasable INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ voucher_profiles ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_profile_areas (
            profile_id INTEGER NOT NULL,
            area_id INTEGER NOT NULL,
            PRIMARY KEY (profile_id, area_id)
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_profile_areas_area ON voucher_profile_areas(area_id)');
    console.log('✓ voucher_profile_areas ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            profile_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'unused',
            source TEXT NOT NULL DEFAULT 'admin',
            buyer_name TEXT,
            buyer_phone TEXT,
            activated_at TEXT,
            expires_at TEXT,
            redeemed_count INTEGER NOT NULL DEFAULT 0,
            code_expires_at TEXT,
            order_ref TEXT,
            created_by INTEGER,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_codes_profile ON voucher_codes(profile_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_codes_status ON voucher_codes(status)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_codes_phone ON voucher_codes(buyer_phone)');
    console.log('✓ voucher_codes ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS voucher_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code_id INTEGER NOT NULL,
            device_hash TEXT NOT NULL,
            buyer_name TEXT,
            buyer_phone TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    // One device redeeming the same code twice must NOT consume a second slot.
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_voucher_redemptions_code_device ON voucher_redemptions(code_id, device_hash)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_voucher_redemptions_code ON voucher_redemptions(code_id)');
    console.log('✓ voucher_redemptions ready');

    if (!hasColumn('areas', 'is_access_gated')) {
        db.exec('ALTER TABLE areas ADD COLUMN is_access_gated INTEGER NOT NULL DEFAULT 0');
        console.log('✓ areas.is_access_gated added');
    } else {
        console.log('  areas.is_access_gated already present — skip');
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
