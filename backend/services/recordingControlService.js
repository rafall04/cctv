// Purpose: One place the API asks for recording work, whether recording runs in this
//          process or in the separate recorder worker.
// Caller: cameraService, cameraHealthService, recordingPlaybackService.
// Deps: config.recording, recordingWorkerStateRepository, recordingService (in-process mode).
// MainFuncs: isWorkerMode, reconcile, start, stop, restart, restartAllActive, getRuntimeStatus.
// SideEffects: In worker mode, queues rows in recording_reconcile_requests; otherwise
//              calls recordingService directly.
//
// WHY THIS INDIRECTION
// --------------------
// The API used to call recordingService.reconcileRecordingLifecycle()/startRecording()
// directly — a plain function call into the same process. Once recording moves to
// `rafnet-cctv-recorder` those calls would either silently do nothing (no recorders
// here) or, worse, spawn a SECOND ffmpeg for a camera the worker is already recording.
//
// Routing every such call through here means the call sites keep reading the same and
// there is exactly one place that knows which process owns recording. In worker mode a
// request row is queued and the worker claims it within ~2s, so an admin toggle still
// feels immediate rather than waiting for the periodic sweep.

import { config } from '../config/config.js';
import workerState from './recordingWorkerStateRepository.js';

let cachedRecordingService = null;

// Imported lazily: pulling in recordingService drags the whole recording domain
// (ffmpeg management, schedulers, finalizer) into the API process, which is exactly
// what worker mode exists to avoid.
async function getRecordingService() {
    if (!cachedRecordingService) {
        ({ recordingService: cachedRecordingService } = await import('./recordingService.js'));
    }
    return cachedRecordingService;
}

export function isWorkerMode() {
    return config.recording?.workerEnabled === true;
}

/*
 * The queue write is the whole request in worker mode — if it fails, nothing will ever happen.
 * requestReconcile swallows its own errors and answers false, and every caller here used to
 * discard that and reply success anyway, so a failed enqueue looked identical to a done job.
 */
function queued(ok, message) {
    return ok
        ? { success: true, queued: true, message }
        : { success: false, queued: false, message: 'Could not queue the request for the recording worker' };
}

export async function reconcile(cameraId, reason = 'api_request') {
    if (isWorkerMode()) {
        const ok = workerState.requestReconcile(cameraId, reason);
        return { ...queued(ok, 'Reconcile requested'), reason };
    }
    const service = await getRecordingService();
    return service.reconcileRecordingLifecycle(cameraId, reason);
}

export async function reconcileAll(reason = 'api_request') {
    if (isWorkerMode()) {
        // Nothing camera-specific to queue — the worker's periodic sweep is the
        // "reconcile everything" path, and it runs on its own schedule.
        return { success: true, queued: false, deferredToWorkerSweep: true, reason };
    }
    const service = await getRecordingService();
    return service.reconcileRecordingLifecycleAll(reason);
}

export async function start(cameraId, reason = 'api_start') {
    if (isWorkerMode()) {
        return queued(workerState.requestReconcile(cameraId, reason, 'start'), 'Recording start requested');
    }
    const service = await getRecordingService();
    return service.startRecording(cameraId);
}

export async function stop(cameraId, options = {}) {
    if (isWorkerMode()) {
        return queued(workerState.requestReconcile(cameraId, options.reason || 'api_stop', 'stop'), 'Recording stop requested');
    }
    const service = await getRecordingService();
    return service.stopRecording(cameraId, options);
}

export async function restart(cameraId, reason = 'api_restart') {
    if (isWorkerMode()) {
        return queued(workerState.requestReconcile(cameraId, reason, 'restart'), 'Recording restart requested');
    }
    const service = await getRecordingService();
    return service.restartRecording(cameraId, reason);
}

/**
 * Restart every camera that is ACTIVELY recording, so a fresh ffmpeg picks up a process-level
 * setting that a running (or adopted) process cannot — notably the timezone ffmpeg bakes into segment
 * FILENAMES at spawn. Enumerated per mode: worker mode reads what the recorder published; in-process
 * mode asks the recorder directly. Best-effort per camera — one enqueue/restart failure never aborts
 * the rest. Returns the camera ids acted on. NOTE: each restart shifts one segment boundary (~3s gap,
 * detach/adopt keeps the footage), so this is for rare admin actions, not a routine path.
 */
export async function restartAllActive(reason = 'api_restart_all') {
    let cameraIds;
    if (isWorkerMode()) {
        cameraIds = workerState.readAllProcessState()
            .filter((row) => row.status === 'recording')
            .map((row) => row.camera_id);
    } else {
        const service = await getRecordingService();
        cameraIds = service.getActiveRecordingCameraIds();
    }
    const restarted = [];
    for (const cameraId of cameraIds) {
        try {
            await restart(cameraId, reason);
            restarted.push(cameraId);
        } catch {
            // best-effort: one camera's failure must not stop the others
        }
    }
    return { restarted };
}

/**
 * Runtime status for one camera.
 *
 * In worker mode the recorder's in-memory map is in another process, so this reads
 * what the worker published. A stale/absent row is reported as `unknown` rather than
 * `stopped` — claiming a camera is not recording when we simply cannot see it would
 * be a lie, and an operator acting on it could double-start a recorder.
 */
export async function getRuntimeStatus(cameraId) {
    if (!isWorkerMode()) {
        const service = await getRecordingService();
        return service.getRecordingStatus(cameraId);
    }

    const heartbeat = workerState.readHealthSnapshot();
    if (heartbeat.stale) {
        return { isRecording: false, status: 'unknown', workerStale: true };
    }

    const row = workerState.readProcessState(cameraId);
    if (!row) {
        return { isRecording: false, status: 'stopped' };
    }

    return {
        isRecording: row.status === 'recording',
        status: row.status,
        pid: row.pid,
        startTime: row.started_at,
        streamSource: row.stream_source,
        adopted: row.adopted === 1,
    };
}

/**
 * Runtime status for MANY cameras in ONE pass, same per-camera shape as getRuntimeStatus().
 *
 * getRuntimeStatus() reads the health snapshot AND a process-state row PER camera. The dashboard
 * overview called it for every enabled camera (757 on prod), so the single health snapshot was
 * re-read 757× and recording_process_state was hit 757× — all synchronous better-sqlite3, blocking
 * the event loop that also serves public HLS. This reads the snapshot once and the whole
 * process-state table once, then maps each id off those in memory.
 *
 * @param {Array<number>} cameraIds
 * @returns {Promise<Map<number, object>>}
 */
export async function getRuntimeStatusMap(cameraIds) {
    const map = new Map();
    if (!isWorkerMode()) {
        // Single-process mode: statuses live in this process, nothing cross-process to batch.
        const service = await getRecordingService();
        for (const id of cameraIds) map.set(id, service.getRecordingStatus(id));
        return map;
    }

    const heartbeat = workerState.readHealthSnapshot();
    if (heartbeat.stale) {
        for (const id of cameraIds) map.set(id, { isRecording: false, status: 'unknown', workerStale: true });
        return map;
    }

    const byCamera = new Map(workerState.readAllProcessState().map((row) => [row.camera_id, row]));
    for (const id of cameraIds) {
        const row = byCamera.get(id);
        map.set(id, row
            ? {
                isRecording: row.status === 'recording',
                status: row.status,
                pid: row.pid,
                startTime: row.started_at,
                streamSource: row.stream_source,
                adopted: row.adopted === 1,
            }
            : { isRecording: false, status: 'stopped' });
    }
    return map;
}

export default {
    isWorkerMode,
    reconcile,
    reconcileAll,
    start,
    stop,
    restart,
    restartAllActive,
    getRuntimeStatus,
    getRuntimeStatusMap,
};
