/**
 * Migration: per-customer private areas ("Area Saya").
 *
 * customer_areas is a SEPARATE namespace from the public `areas` table: each row is
 * owned by exactly one customer (owner_user_id) and is only ever read through
 * owner-scoped customer endpoints. Public/community surfaces query `areas` (+ the
 * camera_class='community' filter) and NEVER join customer_areas, so a customer's
 * private grouping can never leak onto a public surface — safety by construction,
 * not by remembering a filter on every query.
 *
 * cameras.customer_area_id links a subscriber camera to its owner's private area.
 * It is intentionally NOT the public cameras.area_id (which stays for community
 * cameras). Ownership ("this area is mine") is enforced in the service layer; area
 * deletion nulls the link in the service too (FK cascade only fires when SQLite
 * foreign_keys pragma is on).
 *
 * Idempotent: CREATE TABLE/INDEX IF NOT EXISTS, ALTER gated on PRAGMA table_info.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add customer_areas + cameras.customer_area_id...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    db.exec(`
        CREATE TABLE IF NOT EXISTS customer_areas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(owner_user_id, name),
            FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
    console.log('✓ customer_areas table ready');

    db.exec('CREATE INDEX IF NOT EXISTS idx_customer_areas_owner ON customer_areas(owner_user_id)');

    if (!hasColumn('cameras', 'customer_area_id')) {
        db.exec('ALTER TABLE cameras ADD COLUMN customer_area_id INTEGER');
        console.log('✓ cameras.customer_area_id added');
    } else {
        console.log('  cameras.customer_area_id already present — skip');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_cameras_customer_area ON cameras(customer_area_id)');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
