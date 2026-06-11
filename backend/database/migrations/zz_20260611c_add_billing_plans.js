/**
 * Migration: account-level billing plans (paket) + trial support.
 *
 * billing_plans defines admin-editable customer profiles: per-camera monthly
 * price, max self-managed cameras, and optional trial behavior (is_trial +
 * trial_days, charged Rp0 while the trial is running). users gain plan linkage
 * plus trial bookkeeping (trial_used prevents re-running a trial on the same
 * account; uniqueness of self-registered phone numbers is enforced in the
 * service layer, not here, so admin-created users stay unconstrained).
 *
 * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ALTERs gated on PRAGMA
 * table_info, seed only when the table is empty.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add billing plans + user plan columns...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS billing_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            price_per_camera INTEGER NOT NULL DEFAULT 0,
            max_cameras INTEGER NOT NULL DEFAULT 1,
            is_trial INTEGER NOT NULL DEFAULT 0,
            trial_days INTEGER,
            active INTEGER NOT NULL DEFAULT 1,
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('✓ billing_plans table ready');

    const seedCount = db.prepare('SELECT COUNT(*) AS n FROM billing_plans').get().n;
    if (seedCount === 0) {
        const seed = db.prepare(`
            INSERT INTO billing_plans (key, name, description, price_per_camera, max_cameras, is_trial, trial_days, active, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        seed.run('trial', 'Trial Gratis', 'Coba gratis sebelum berlangganan', 0, 1, 1, 3, 1, 1);
        seed.run('basic', 'Basic', '1 kamera, cocok untuk rumah', 25000, 1, 0, null, 1, 2);
        seed.run('hemat', 'Hemat', 'Sampai 3 kamera, lebih murah per kamera', 20000, 3, 0, null, 1, 3);
        seed.run('bisnis', 'Bisnis', 'Sampai 10 kamera, harga terbaik per kamera', 15000, 10, 0, null, 1, 4);
        console.log('✓ billing_plans seeded (trial/basic/hemat/bisnis)');
    } else {
        console.log(`  billing_plans already populated (${seedCount} rows) — skip seed`);
    }

    if (!hasColumn('users', 'plan_id')) {
        db.exec('ALTER TABLE users ADD COLUMN plan_id INTEGER');
        console.log('✓ users.plan_id added');
    } else {
        console.log('  users.plan_id already present — skip');
    }
    if (!hasColumn('users', 'plan_started_at')) {
        db.exec('ALTER TABLE users ADD COLUMN plan_started_at TEXT');
        console.log('✓ users.plan_started_at added');
    } else {
        console.log('  users.plan_started_at already present — skip');
    }
    if (!hasColumn('users', 'trial_ends_at')) {
        db.exec('ALTER TABLE users ADD COLUMN trial_ends_at TEXT');
        console.log('✓ users.trial_ends_at added');
    } else {
        console.log('  users.trial_ends_at already present — skip');
    }
    if (!hasColumn('users', 'trial_used')) {
        db.exec('ALTER TABLE users ADD COLUMN trial_used INTEGER NOT NULL DEFAULT 0');
        console.log('✓ users.trial_used added');
    } else {
        console.log('  users.trial_used already present — skip');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_users_plan_id ON users(plan_id)');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
