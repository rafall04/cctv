// Purpose: Tables that let the recording domain run in its OWN process while the API
//          process can still observe it and ask it to act.
// Caller: Backend migration runner (npm run migrate).
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates recording_process_state, recording_health_snapshot,
//              recording_reconcile_requests when missing. Idempotent.
//
// WHY THESE EXIST
// ---------------
// Splitting recording into `rafnet-cctv-recorder` removes the in-process function
// calls the API used to rely on. Three of them need a replacement, and SQLite (already
// in WAL mode, so multi-process is safe) is the interface:
//
//   recording_process_state      — the API can no longer read the recorder's in-memory
//                                  runtime map, so the recorder publishes it here.
//   recording_health_snapshot    — same problem for the recording-health dashboard,
//                                  which composed scheduler/queue telemetry in-process.
//   recording_reconcile_requests — the API used to call reconcileRecordingLifecycle()
//                                  directly on camera/health/settings changes. It now
//                                  leaves a request the recorder picks up within a
//                                  couple of seconds, so an admin toggle still feels
//                                  immediate instead of waiting for the periodic sweep.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    // One row per camera the recorder currently has a process for.
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_process_state (
            camera_id      INTEGER PRIMARY KEY,
            pid            INTEGER,
            status         TEXT NOT NULL,
            stream_source  TEXT,
            adopted        INTEGER NOT NULL DEFAULT 0,
            started_at     TEXT,
            updated_at     TEXT NOT NULL
        )
    `);

    // Single-row table (id = 1). Holds the JSON the dashboard endpoint used to build
    // in-process, plus the heartbeat that tells the API whether the recorder is alive.
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_health_snapshot (
            id           INTEGER PRIMARY KEY CHECK (id = 1),
            snapshot     TEXT NOT NULL,
            worker_pid   INTEGER,
            updated_at   TEXT NOT NULL
        )
    `);

    // Work queue, not a log: the recorder deletes rows once it has acted on them.
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_reconcile_requests (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id     INTEGER NOT NULL,
            reason        TEXT NOT NULL,
            requested_at  TEXT NOT NULL
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_reconcile_requests_camera
        ON recording_reconcile_requests(camera_id)
    `);

    console.log('Recording worker tables ready (process_state, health_snapshot, reconcile_requests)');
} finally {
    db.close();
}
