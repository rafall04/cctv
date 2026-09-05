// Purpose: One-time cleanup of ended (is_active = 0) viewer_sessions rows — pure bloat.
// Caller: Backend migration runner.
// Deps: better-sqlite3 database file, viewer_sessions table.
// MainFuncs: migration script body.
// SideEffects: Deletes viewer_sessions rows where is_active = 0.
//
// An ended session is copied into viewer_session_history and then read by NOTHING — every
// viewer_sessions reader filters is_active = 1. The old endSession still kept the row (UPDATE
// is_active = 0), so ended rows piled up: ~76k on production, +~600/day, amplifying writes on the
// hottest public path (every live /start) against a 7-index table. endSession now DELETEs on end, so
// this clears the historical backlog. Idempotent: after the code fix there are ~no is_active=0 rows,
// and a re-run deletes zero.

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';

const db = new Database(resolveDbPath());

try {
    const table = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'viewer_sessions'"
    ).get();
    if (!table) {
        console.log('viewer_sessions table does not exist yet; skipping ended-session prune');
        process.exit(0);
    }

    const before = db.prepare('SELECT COUNT(*) AS c FROM viewer_sessions WHERE is_active = 0').get().c;
    const result = db.prepare('DELETE FROM viewer_sessions WHERE is_active = 0').run();
    console.log(`Pruned ${result.changes} ended viewer_sessions rows (backlog was ${before})`);
} finally {
    db.close();
}
