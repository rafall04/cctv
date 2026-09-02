// Purpose: Drop the legacy failed_remux_files table; failure tracking moved to recording_recovery_diagnostics.
// Caller: Backend migration runner after recording maintenance state migration.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Removes the failed_remux_files table if it still exists.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = resolveDbPath();
const db = new Database(dbPath);

try {
    db.exec('DROP TABLE IF EXISTS failed_remux_files;');
    console.log('Dropped legacy failed_remux_files table');
} finally {
    db.close();
}
