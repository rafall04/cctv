// Purpose: Reconcile desired recording state against active FFmpeg process state.
// Caller: recordingService startup/periodic work and cameraHealthService online/offline signals.
// Deps: connectionPool, recordingLifecyclePolicy, recordingService facade, recordingProcessManager.
// MainFuncs: createRecordingLifecycleReconciler, reconcileCamera, reconcileAll.
// SideEffects: Reads camera DB state and delegates recording start/stop; does not delete or quarantine files.

import { query as defaultQuery, queryOne as defaultQueryOne } from '../database/connectionPool.js';
import { decideRecordingLifecycleAction } from './recordingLifecyclePolicy.js';

const CAMERA_SELECT = `
    SELECT id, enabled, enable_recording, is_online, delivery_type, stream_source,
           private_rtsp_url, external_hls_url, recording_status
    FROM cameras
`;

export function createRecordingLifecycleReconciler({
    query = defaultQuery,
    queryOne = defaultQueryOne,
    recordingService,
    recordingProcessManager,
    logger = console,
} = {}) {
    if (!recordingService) {
        throw new Error('recordingService dependency is required');
    }
    if (!recordingProcessManager) {
        throw new Error('recordingProcessManager dependency is required');
    }

    const inFlight = new Set();

    async function applyDecision(camera, decision, now) {
        if (decision.action === 'start') {
            const result = await recordingService.handleCameraBecameOnline(camera.id, now, {
                clearCooldown: decision.clearCooldown,
            });
            return { cameraId: camera.id, action: decision.action, success: result?.success !== false, decision, result };
        }

        if (decision.action === 'stop_offline') {
            const result = await recordingService.handleCameraBecameOffline(camera.id, now);
            return { cameraId: camera.id, action: decision.action, success: result?.success !== false, decision, result };
        }

        return { cameraId: camera.id, action: decision.action, success: true, decision };
    }

    async function reconcileCameraSnapshot(camera, reason = 'periodic_safety_net', now = Date.now()) {
        const cameraId = camera?.id;
        if (!cameraId) {
            return { cameraId: null, action: 'noop_missing', success: true, reason };
        }

        if (inFlight.has(cameraId)) {
            return { cameraId, action: 'skipped_in_flight', success: true, reason };
        }

        inFlight.add(cameraId);
        try {
            const processStatus = recordingProcessManager.getStatus(cameraId);
            const recordingStatus = recordingService.getRecordingStatus(cameraId);
            const decision = decideRecordingLifecycleAction({
                camera,
                processStatus,
                recordingStatus,
                now,
            });
            const result = await applyDecision(camera, decision, now);
            return { ...result, reason };
        } catch (error) {
            logger.error?.(`[RecordingReconciler] Failed to reconcile camera ${cameraId}:`, error.message);
            return { cameraId, action: 'error', success: false, reason, error: error.message };
        } finally {
            inFlight.delete(cameraId);
        }
    }

    async function reconcileCamera(cameraId, reason = 'manual', now = Date.now()) {
        const camera = queryOne(`${CAMERA_SELECT} WHERE id = ?`, [cameraId]);
        if (!camera) {
            return { cameraId, action: 'noop_missing', success: true, reason: 'camera_missing' };
        }
        return reconcileCameraSnapshot(camera, reason, now);
    }

    async function reconcileAll(reason = 'periodic_safety_net', now = Date.now()) {
        const cameras = query(`${CAMERA_SELECT} WHERE enabled = 1 AND enable_recording = 1 ORDER BY id ASC`);
        const results = [];
        for (const camera of cameras) {
            results.push(await reconcileCameraSnapshot(camera, reason, now));
        }
        return { success: true, checked: cameras.length, results };
    }

    function isInFlight(cameraId) {
        return inFlight.has(cameraId);
    }

    return { reconcileCamera, reconcileAll, isInFlight };
}
