// Purpose: Add retry and quarantine fields to recording recovery diagnostics.
// Caller: Backend migration runner after recording_recovery_diagnostics exists.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Adds nullable columns and indexes for recovery attempt tracking.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function columnExists(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

try {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_recovery_diagnostics'
    `).get();

    if (!table) {
        console.log('recording_recovery_diagnostics table does not exist yet; skipping attempt fields migration');
        process.exit(0);
    }

    if (!columnExists('recording_recovery_diagnostics', 'attempt_count')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN attempt_count INTEGER DEFAULT 0');
    }
    if (!columnExists('recording_recovery_diagnostics', 'terminal_state')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN terminal_state TEXT');
    }
    if (!columnExists('recording_recovery_diagnostics', 'quarantined_path')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN quarantined_path TEXT');
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_recovery_attempt_state
        ON recording_recovery_diagnostics(active, state, attempt_count)
    `);

    console.log('Added recording recovery attempt fields');
} finally {
    db.close();
}
