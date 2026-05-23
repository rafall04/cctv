/**
 * Migration: introduce admin-editable sponsor package catalog + per-sponsor
 * camera_limit, and drop the rigid CHECK(package IN ('bronze','silver','gold'))
 * constraint on the sponsors table so admins can define custom package keys
 * (e.g. "Paket Sukamaju") through the new sponsor_packages table.
 *
 * Forward-only and idempotent:
 *   - sponsor_packages: CREATE TABLE IF NOT EXISTS + conditional seed.
 *   - sponsors.camera_limit: ALTER TABLE ADD COLUMN gated on PRAGMA table_info.
 *   - CHECK-constraint removal: rebuild sponsors table only when the legacy
 *     CHECK is still present in sqlite_master.sql. Existing rows preserved.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

console.log('Starting migration: add sponsor_packages + sponsors.camera_limit + drop package CHECK...');

const db = new Database(dbPath);

try {
    db.exec('BEGIN');

    // 1. Sponsor packages catalog
    db.exec(`
        CREATE TABLE IF NOT EXISTS sponsor_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT 'gray',
            default_price REAL DEFAULT 0,
            default_camera_limit INTEGER, -- NULL = unlimited
            features_json TEXT NOT NULL DEFAULT '[]',
            sort_order INTEGER NOT NULL DEFAULT 100,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    console.log('   sponsor_packages table ready');

    const seedCount = db.prepare('SELECT COUNT(*) AS n FROM sponsor_packages').get().n;
    if (seedCount === 0) {
        const seedStmt = db.prepare(`
            INSERT INTO sponsor_packages
            (key, name, color, default_price, default_camera_limit, features_json, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const defaults = [
            ['gold', 'Gold', 'yellow', 3_000_000, null,
                JSON.stringify(['Logo di semua kamera', 'Banner premium', 'Dedicated page', 'Social media promo', 'Monthly report']), 1],
            ['silver', 'Silver', 'gray', 1_500_000, 3,
                JSON.stringify(['Logo di 3 kamera', 'Banner di landing page', 'Social media mention', 'Dedicated page']), 2],
            ['bronze', 'Bronze', 'orange', 500_000, 1,
                JSON.stringify(['Logo di 1 kamera', 'Mention di deskripsi', 'Link ke website']), 3],
        ];
        for (const row of defaults) seedStmt.run(row);
        console.log('   sponsor_packages seeded with bronze/silver/gold defaults');
    } else {
        console.log(`   sponsor_packages already populated (${seedCount} rows) — skip seed`);
    }

    // 2. Inspect current sponsors table for both camera_limit + CHECK presence.
    const sponsorsRow = db.prepare(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='sponsors'"
    ).get();
    const sponsorsSql = sponsorsRow?.sql || '';
    const hasCheckConstraint = /CHECK\s*\(\s*package\s+IN/i.test(sponsorsSql);
    const tableInfo = db.prepare('PRAGMA table_info(sponsors)').all();
    const hasCameraLimit = tableInfo.some((col) => col.name === 'camera_limit');

    if (!hasCheckConstraint) {
        if (!hasCameraLimit) {
            db.exec('ALTER TABLE sponsors ADD COLUMN camera_limit INTEGER');
            console.log('   sponsors.camera_limit added');
        } else {
            console.log('   sponsors.camera_limit already present — skip');
        }
    } else {
        // 3. Rebuild sponsors WITHOUT the CHECK so admins can use custom keys.
        //    Camera_limit gets added as part of the new schema in the same pass.
        console.log('   rebuilding sponsors to drop legacy package CHECK + add camera_limit...');

        db.exec(`
            CREATE TABLE sponsors_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                logo TEXT,
                url TEXT,
                package TEXT,
                price REAL,
                active INTEGER DEFAULT 1,
                start_date DATE,
                end_date DATE,
                contact_name TEXT,
                contact_email TEXT,
                contact_phone TEXT,
                notes TEXT,
                camera_limit INTEGER,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Pull only the columns we know exist on the old table. camera_limit
        // is filled with NULL (= unlimited) for existing rows.
        const copyColumns = [
            'id', 'name', 'logo', 'url', 'package', 'price', 'active',
            'start_date', 'end_date', 'contact_name', 'contact_email',
            'contact_phone', 'notes', 'created_at', 'updated_at',
        ];
        db.exec(`
            INSERT INTO sponsors_new (${copyColumns.join(', ')})
            SELECT ${copyColumns.join(', ')} FROM sponsors
        `);

        db.exec('DROP TABLE sponsors');
        db.exec('ALTER TABLE sponsors_new RENAME TO sponsors');
        console.log('   sponsors rebuilt without CHECK constraint, camera_limit included');
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
