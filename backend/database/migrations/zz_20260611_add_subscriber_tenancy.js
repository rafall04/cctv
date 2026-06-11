/**
 * Migration: subscriber tenancy foundation.
 *
 * Adds camera ownership + class segregation so rented (subscriber) and
 * owner-private cameras can be hard-separated from the public community hub:
 *   - cameras.owner_user_id  (NULL = platform/community camera)
 *   - cameras.camera_class   ('community' | 'owner_private' | 'subscriber')
 *   - cameras.billing_status ('active' | 'suspended', subscriber-class only)
 *   - users.phone / users.email (billing contact, admin-entered)
 *
 * Idempotent: every ALTER is gated on PRAGMA table_info; indexes use
 * IF NOT EXISTS. Existing rows keep working — camera_class defaults to
 * 'community' so current public behavior is unchanged.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add subscriber tenancy columns...');

const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((col) => col.name === column);
}

try {
    db.exec('BEGIN');

    if (!hasColumn('cameras', 'owner_user_id')) {
        db.exec('ALTER TABLE cameras ADD COLUMN owner_user_id INTEGER');
        console.log('✓ cameras.owner_user_id added');
    } else {
        console.log('  cameras.owner_user_id already present — skip');
    }

    if (!hasColumn('cameras', 'camera_class')) {
        db.exec("ALTER TABLE cameras ADD COLUMN camera_class TEXT NOT NULL DEFAULT 'community'");
        console.log('✓ cameras.camera_class added');
    } else {
        console.log('  cameras.camera_class already present — skip');
    }

    if (!hasColumn('cameras', 'billing_status')) {
        db.exec('ALTER TABLE cameras ADD COLUMN billing_status TEXT');
        console.log('✓ cameras.billing_status added');
    } else {
        console.log('  cameras.billing_status already present — skip');
    }

    if (!hasColumn('users', 'phone')) {
        db.exec('ALTER TABLE users ADD COLUMN phone TEXT');
        console.log('✓ users.phone added');
    } else {
        console.log('  users.phone already present — skip');
    }

    if (!hasColumn('users', 'email')) {
        db.exec('ALTER TABLE users ADD COLUMN email TEXT');
        console.log('✓ users.email added');
    } else {
        console.log('  users.email already present — skip');
    }

    db.exec('CREATE INDEX IF NOT EXISTS idx_cameras_camera_class ON cameras(camera_class)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_cameras_owner_user_id ON cameras(owner_user_id)');
    console.log('✓ tenancy indexes ready');

    db.exec('COMMIT');
    console.log('Migration completed successfully');
} catch (error) {
    db.exec('ROLLBACK');
    console.error('Migration failed:', error.message);
    throw error;
} finally {
    db.close();
}
