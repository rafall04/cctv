#!/usr/bin/env node

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();

function runMigration() {
    const db = new Database(dbPath);

    try {
        const columns = db.prepare("PRAGMA table_info(areas)").all();
        const hasColumn = columns.some((column) => column.name === 'grid_default_camera_limit');

        if (!hasColumn) {
            db.exec('ALTER TABLE areas ADD COLUMN grid_default_camera_limit INTEGER DEFAULT 12');
            db.exec('UPDATE areas SET grid_default_camera_limit = 12 WHERE grid_default_camera_limit IS NULL');
            console.log('Added areas.grid_default_camera_limit');
        } else {
            console.log('areas.grid_default_camera_limit already exists');
        }
    } finally {
        db.close();
    }
}

runMigration();

export default runMigration;
