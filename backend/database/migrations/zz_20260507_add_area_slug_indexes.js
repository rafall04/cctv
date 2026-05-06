/**
 * Purpose: Persist canonical public area slugs and index slug lookups for public area pages.
 * Caller: run_all_migrations and backend migration gate.
 * Deps: better-sqlite3, Node path/url helpers, areas table.
 * MainFuncs: columnExists, indexExists, toSlug.
 * SideEffects: Adds areas.slug, backfills slugs, and creates idx_areas_slug.
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');

const db = new Database(dbPath);

function columnExists(tableName, columnName) {
    return db.prepare(`PRAGMA table_info(${tableName})`).all()
        .some((column) => column.name === columnName);
}

function indexExists(indexName) {
    return db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'index' AND name = ?
    `).get(indexName);
}

function toSlug(value = '') {
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-');
}

try {
    console.log('Running migration: zz_20260507_add_area_slug_indexes');

    if (!columnExists('areas', 'slug')) {
        db.exec('ALTER TABLE areas ADD COLUMN slug TEXT');
    }

    const areas = db.prepare('SELECT id, name, slug FROM areas').all();
    const updateSlug = db.prepare('UPDATE areas SET slug = ? WHERE id = ?');
    const transaction = db.transaction((rows) => {
        rows.forEach((area) => {
            if (area.slug) {
                return;
            }
            updateSlug.run(toSlug(area.name), area.id);
        });
    });
    transaction(areas);

    if (!indexExists('idx_areas_slug')) {
        db.exec('CREATE INDEX idx_areas_slug ON areas(slug)');
    }

    console.log('Migration complete: zz_20260507_add_area_slug_indexes');
} finally {
    db.close();
}
