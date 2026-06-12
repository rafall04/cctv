/**
 * Migration: promo codes — wallet top-up bonuses (percent/flat) + instant gift credit.
 *
 * promo_codes: a code with a type (`percent` bonus % of top-up, `flat` bonus rupiah on
 * top-up, `gift` instant wallet credit), value, optional caps (max_bonus for percent,
 * min_topup, max_uses total, per_user_limit), active flag and expiry.
 * promo_redemptions: one row per successful redemption (for per-user + total limits + audit).
 * payments gains promo_code + promo_bonus so a top-up's bonus is credited exactly once when
 * the payment is confirmed.
 *
 * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ALTERs gated on PRAGMA table_info.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add promo codes...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_codes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            type TEXT NOT NULL,
            value INTEGER NOT NULL,
            max_bonus INTEGER,
            min_topup INTEGER NOT NULL DEFAULT 0,
            max_uses INTEGER,
            used_count INTEGER NOT NULL DEFAULT 0,
            per_user_limit INTEGER NOT NULL DEFAULT 1,
            active INTEGER NOT NULL DEFAULT 1,
            expires_at TEXT,
            description TEXT,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ promo_codes table ready');

    db.exec(`
        CREATE TABLE IF NOT EXISTS promo_redemptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            promo_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            payment_id INTEGER,
            bonus_amount INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_promo_redemptions_promo_user ON promo_redemptions(promo_id, user_id)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_promo_redemptions_payment ON promo_redemptions(payment_id)');
    console.log('✓ promo_redemptions table ready');

    if (!hasColumn('payments', 'promo_code')) {
        db.exec('ALTER TABLE payments ADD COLUMN promo_code TEXT');
        console.log('✓ payments.promo_code added');
    } else {
        console.log('  payments.promo_code already present — skip');
    }
    if (!hasColumn('payments', 'promo_bonus')) {
        db.exec('ALTER TABLE payments ADD COLUMN promo_bonus INTEGER NOT NULL DEFAULT 0');
        console.log('✓ payments.promo_bonus added');
    } else {
        console.log('  payments.promo_bonus already present — skip');
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
