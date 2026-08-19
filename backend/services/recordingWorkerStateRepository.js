// Purpose: The DB interface between the API process and the recording worker.
// Caller: recorder.js (writes), recordingPlaybackService / health dashboard (reads),
//         recordingControlService (queues reconcile requests).
// Deps: connectionPool query/queryOne/execute.
// MainFuncs: publishProcessState, clearProcessState, readProcessState, readAllProcessState,
//            publishHealthSnapshot, readHealthSnapshot, requestReconcile, takeReconcileRequests.
// SideEffects: Writes recording_process_state / recording_health_snapshot /
//              recording_reconcile_requests.
//
// Once recording runs in its own process, the API can no longer read the recorder's
// in-memory state or call into its lifecycle. SQLite (WAL — concurrent readers, one
// writer, busy_timeout already configured) is the interface. Everything here is
// defensive: a missing table or a dead worker degrades to "unknown", never an
// exception, because none of this is worth failing an API request over.

import { execute, query, queryOne } from '../database/connectionPool.js';

// How stale the worker heartbeat may get before the API should stop trusting it.
// Comfortably above the recorder's publish interval so a slow tick is not "dead".
export const WORKER_HEARTBEAT_STALE_MS = 90 * 1000;

function nowIso() {
    return new Date().toISOString();
}

function safe(fn, fallback) {
    try {
        return fn();
    } catch {
        // Table not migrated yet, or DB briefly locked. Callers treat this as "unknown".
        return fallback;
    }
}

export function publishProcessState(cameraId, { pid, status, streamSource, adopted, startedAt }) {
    return safe(() => {
        execute(
            `INSERT INTO recording_process_state
                 (camera_id, pid, status, stream_source, adopted, started_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(camera_id) DO UPDATE SET
                 pid = excluded.pid,
                 status = excluded.status,
                 stream_source = excluded.stream_source,
                 adopted = excluded.adopted,
                 started_at = excluded.started_at,
                 updated_at = excluded.updated_at`,
            [
                cameraId,
                pid ?? null,
                status,
                streamSource ?? null,
                adopted ? 1 : 0,
                startedAt ? new Date(startedAt).toISOString() : null,
                nowIso(),
            ]
        );
        return true;
    }, false);
}

export function clearProcessState(cameraId) {
    return safe(() => {
        execute('DELETE FROM recording_process_state WHERE camera_id = ?', [cameraId]);
        return true;
    }, false);
}

export function readProcessState(cameraId) {
    return safe(
        () => queryOne('SELECT * FROM recording_process_state WHERE camera_id = ?', [cameraId]) || null,
        null
    );
}

export function readAllProcessState() {
    return safe(() => query('SELECT * FROM recording_process_state'), []);
}

/**
 * Replace the worker's published health snapshot. Single row by design — this is a
 * current-state mirror, not history.
 */
export function publishHealthSnapshot(snapshot, workerPid = process.pid) {
    return safe(() => {
        execute(
            `INSERT INTO recording_health_snapshot (id, snapshot, worker_pid, updated_at)
             VALUES (1, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
                 snapshot = excluded.snapshot,
                 worker_pid = excluded.worker_pid,
                 updated_at = excluded.updated_at`,
            [JSON.stringify(snapshot ?? {}), workerPid ?? null, nowIso()]
        );
        return true;
    }, false);
}

/**
 * Read the worker's snapshot. Reports staleness explicitly rather than silently
 * serving old numbers as if they were live — a dashboard that looks healthy because
 * nobody is updating it is worse than one that admits it does not know.
 */
export function readHealthSnapshot(nowMs = Date.now()) {
    const row = safe(() => queryOne('SELECT * FROM recording_health_snapshot WHERE id = 1'), null);
    if (!row) {
        return { available: false, stale: true, snapshot: null, updatedAt: null, workerPid: null };
    }

    const updatedMs = Date.parse(row.updated_at);
    const stale = !Number.isFinite(updatedMs) || (nowMs - updatedMs) > WORKER_HEARTBEAT_STALE_MS;

    let snapshot = null;
    try {
        snapshot = JSON.parse(row.snapshot);
    } catch {
        snapshot = null;
    }

    return {
        available: snapshot !== null,
        stale,
        snapshot,
        updatedAt: row.updated_at,
        workerPid: row.worker_pid,
        ageMs: Number.isFinite(updatedMs) ? nowMs - updatedMs : null,
    };
}

/**
 * Ask the recorder to reconcile a camera now. Replaces a direct in-process call to
 * reconcileRecordingLifecycle() — without it, an admin toggle would sit until the
 * recorder's periodic sweep came round.
 */
/**
 * Actions the worker can be asked to perform, weakest first.
 *
 * 'reconcile' means "make the world match the database" and is a DESIRED-STATE decision. The
 * others are imperatives — they must happen even when desired state says nothing needs to change,
 * which is exactly the case that used to swallow them.
 */
export const RECONCILE_ACTIONS = ['reconcile', 'start', 'restart', 'stop'];

export function requestReconcile(cameraId, reason = 'api_request', action = 'reconcile') {
    const safeAction = RECONCILE_ACTIONS.includes(action) ? action : 'reconcile';
    return safe(() => {
        execute(
            'INSERT INTO recording_reconcile_requests (camera_id, reason, requested_at, action) VALUES (?, ?, ?, ?)',
            [cameraId, reason, nowIso(), safeAction]
        );
        return true;
    }, false);
}

/**
 * Claim pending requests: read them, delete them, return one entry per camera.
 * Coalesced because ten requests for the same camera still only need one reconcile.
 */
export function takeReconcileRequests(limit = 200) {
    return safe(() => {
        const rows = query(
            "SELECT id, camera_id, reason, COALESCE(action, 'reconcile') AS action FROM recording_reconcile_requests ORDER BY id LIMIT ?",
            [limit]
        );
        if (rows.length === 0) {
            return [];
        }

        const ids = rows.map((row) => row.id);
        execute(
            `DELETE FROM recording_reconcile_requests WHERE id IN (${ids.map(() => '?').join(',')})`,
            ids
        );

        // Coalescing keeps ONE entry per camera, and which one it keeps matters. First-wins used
        // to be fine when every row said the same thing; now an imperative must never be swallowed
        // by a routine reconcile that happened to be queued after it. So an imperative always beats
        // a plain reconcile, and among imperatives the most recent wins — that is the operator's
        // latest intent.
        const byCamera = new Map();
        for (const row of rows) {
            const previous = byCamera.get(row.camera_id);
            const isImperative = row.action !== 'reconcile';
            if (previous && !isImperative) {
                continue;
            }
            byCamera.set(row.camera_id, { cameraId: row.camera_id, reason: row.reason, action: row.action });
        }
        return [...byCamera.values()];
    }, []);
}

export default {
    publishProcessState,
    clearProcessState,
    readProcessState,
    readAllProcessState,
    publishHealthSnapshot,
    readHealthSnapshot,
    requestReconcile,
    takeReconcileRequests,
    WORKER_HEARTBEAT_STALE_MS,
};
