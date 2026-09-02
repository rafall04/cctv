/*
Purpose: Give recording_reconcile_requests an explicit ACTION, so an imperative command
         (stop / restart / start) survives the trip to the recorder worker.
Caller: run-all-migrations (filename order).
Deps: better-sqlite3 against backend/data/cctv.db.
SideEffects: ALTER TABLE recording_reconcile_requests ADD COLUMN action. Idempotent.

WHY
---
In worker mode the API cannot call the recorder; it queues a row and the worker acts on it.
Every row said the same thing — "reconcile this camera" — and reconcile is a DESIRED-STATE
decision: a camera that is enabled, recordable, online and already recording resolves to
`noop_recording`. So two imperative commands silently did nothing while answering success:

  * changing a camera's RTSP URL never restarted its recorder — it kept recording the OLD
    source indefinitely, which is the worst kind of silent failure: footage that looks fine
    and shows the wrong camera;
  * the admin "stop recording" button was a complete no-op.

The action column is what lets the worker tell "make the world match the database" apart from
"do this now". Defaults to 'reconcile' so any row written by an older process still behaves
exactly as before.
*/

import Database from 'better-sqlite3';
import { resolveDbPath } from '../dbPath.js';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = resolveDbPath();
const db = new Database(dbPath);

function hasColumn(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((row) => row.name === column);
}

try {
    const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='recording_reconcile_requests'")
        .get();

    if (!tableExists) {
        console.log('recording_reconcile_requests not present yet — nothing to alter');
    } else if (hasColumn('recording_reconcile_requests', 'action')) {
        console.log('recording_reconcile_requests.action already present');
    } else {
        db.exec('BEGIN');
        db.exec("ALTER TABLE recording_reconcile_requests ADD COLUMN action TEXT NOT NULL DEFAULT 'reconcile'");
        db.exec('COMMIT');
        console.log('Added recording_reconcile_requests.action');
    }
} catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* nothing open */ }
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
