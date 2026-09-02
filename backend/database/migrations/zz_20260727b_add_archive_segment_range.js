// Purpose: Add the segment END time + duration to telegram_archive_uploads.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file, telegram_archive_uploads table.
// MainFuncs: migration script body.
// SideEffects: Adds two nullable columns when missing. Idempotent.
//
// A recording segment is a RANGE. The first cut of this table stored only the start, so the
// archive page could say "19.32" but not "19.32 -> 19.42 (10 menit)" — which is the thing an
// operator actually needs when hunting for an incident.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(resolveDbPath());

try {
    const exists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='telegram_archive_uploads'",
    ).get();
    if (!exists) {
        console.log('telegram_archive_uploads not present yet; skipping');
        process.exit(0);
    }
    const columns = db.prepare('PRAGMA table_info(telegram_archive_uploads)').all().map((c) => c.name);
    if (!columns.includes('recorded_until')) {
        db.exec('ALTER TABLE telegram_archive_uploads ADD COLUMN recorded_until TEXT');
        console.log('added recorded_until');
    }
    if (!columns.includes('duration_seconds')) {
        db.exec('ALTER TABLE telegram_archive_uploads ADD COLUMN duration_seconds INTEGER');
        console.log('added duration_seconds');
    }
} catch (error) {
    console.error('archive segment-range migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
