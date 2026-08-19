// Purpose: One place the API asks for recording work, whether recording runs in this
//          process or in the separate recorder worker.
// Caller: cameraService, cameraHealthService, recordingPlaybackService.
// Deps: config.recording, recordingWorkerStateRepository, recordingService (in-process mode).
// MainFuncs: isWorkerMode, reconcile, start, stop, restart, getRuntimeStatus.
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

export async function reconcile(cameraId, reason = 'api_request') {
    if (isWorkerMode()) {
        workerState.requestReconcile(cameraId, reason);
        return { success: true, queued: true, reason };
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
        workerState.requestReconcile(cameraId, reason, 'start');
        return { success: true, queued: true, message: 'Recording start requested' };
    }
    const service = await getRecordingService();
    return service.startRecording(cameraId);
}

export async function stop(cameraId, options = {}) {
    if (isWorkerMode()) {
        workerState.requestReconcile(cameraId, options.reason || 'api_stop', 'stop');
        return { success: true, queued: true, message: 'Recording stop requested' };
    }
    const service = await getRecordingService();
    return service.stopRecording(cameraId, options);
}

export async function restart(cameraId, reason = 'api_restart') {
    if (isWorkerMode()) {
        workerState.requestReconcile(cameraId, reason, 'restart');
        return { success: true, queued: true, message: 'Recording restart requested' };
    }
    const service = await getRecordingService();
    return service.restartRecording(cameraId, reason);
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

export default {
    isWorkerMode,
    reconcile,
    reconcileAll,
    start,
    stop,
    restart,
    getRuntimeStatus,
};
