/**
 * Purpose: Support RENEWAL (perpanjang) of playback tokens and anonymous token recovery. Adds
 *          order_kind / renew_token_id / recovery_code to playback_orders, and an idempotency ledger
 *          playback_token_renewals so one paid order can extend a token EXACTLY once.
 * Caller: `npm run migrate` via backend/database/run-all-migrations.js.
 * Deps: better-sqlite3, backend/data/cctv.db, playback_orders, playback_tokens.
 * MainFuncs: migration script body.
 * SideEffects: Adds three nullable columns to playback_orders + one new table + indexes (idempotent).
 */

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = resolveDbPath();
const db = new Database(dbPath);

console.log('Running migration: zz_20260903_add_playback_renewal');
console.log('Database path:', dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

try {
    // --- playback_orders: renewal + recovery columns ---
    if (!hasColumn('playback_orders', 'order_kind')) {
        db.exec("ALTER TABLE playback_orders ADD COLUMN order_kind TEXT NOT NULL DEFAULT 'purchase'");
        console.log('  + added playback_orders.order_kind');
    } else {
        console.log('  = playback_orders.order_kind already present');
    }
    if (!hasColumn('playback_orders', 'renew_token_id')) {
        db.exec('ALTER TABLE playback_orders ADD COLUMN renew_token_id INTEGER');
        console.log('  + added playback_orders.renew_token_id');
    } else {
        console.log('  = playback_orders.renew_token_id already present');
    }
    if (!hasColumn('playback_orders', 'recovery_code')) {
        db.exec('ALTER TABLE playback_orders ADD COLUMN recovery_code TEXT');
        console.log('  + added playback_orders.recovery_code');
    } else {
        console.log('  = playback_orders.recovery_code already present');
    }
    // Recovery lookup by (phone, code); code alone stays non-unique so a typo can never collide fatally.
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_recovery ON playback_orders(buyer_phone, recovery_code)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_orders_renew_token ON playback_orders(renew_token_id)');

    // --- idempotency ledger: one row per order that renewed a token ---
    // order_id UNIQUE is the exactly-once guarantee: a re-run's INSERT throws and the whole
    // renewal transaction (incl. the expiry bump) rolls back. order_id is NULL for admin manual
    // renewals (SQLite treats multiple NULLs as distinct, so those are never deduped — intended).
    db.exec(`
        CREATE TABLE IF NOT EXISTS playback_token_renewals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER UNIQUE,
            token_id INTEGER NOT NULL,
            days_added INTEGER NOT NULL,
            previous_expires_at TEXT,
            new_expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    db.exec('CREATE INDEX IF NOT EXISTS idx_playback_token_renewals_token ON playback_token_renewals(token_id, created_at)');
    console.log('✓ playback_token_renewals ready');

    console.log('Migration complete: zz_20260903_add_playback_renewal');
} catch (error) {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
