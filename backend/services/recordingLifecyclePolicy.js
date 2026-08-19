// Purpose: Decide desired recording lifecycle actions from camera and process state.
// Caller: recordingLifecycleReconciler and focused policy tests.
// Deps: recordingIntervalsPolicy constants (pure).
// MainFuncs: isRecordableCamera, decideRecordingLifecycleAction, hasFreshRecordingData.
// SideEffects: None; pure policy only.

import {
    RECORDING_HEALTH_TIMEOUT_INTERNAL_MS,
    RECORDING_HEALTH_TIMEOUT_TUNNEL_MS,
} from './recordingIntervalsPolicy.js';

const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

function isEnabled(value) {
    return value === 1 || value === true;
}

function isStopped(processStatus = {}) {
    return !processStatus || processStatus.status === 'stopped';
}

/**
 * Is FFmpeg still being fed by this camera right now?
 *
 * `lastDataAt` advances whenever FFmpeg writes to its stderr log, and the `-stats` heartbeat ticks
 * sub-second for as long as it is pulling — so fresh here means the camera is genuinely still
 * handing us media. Same signal and same window the recording health monitor already uses to
 * decide a stream is not frozen; both must agree or they fight over the same process.
 *
 * Unknown (`null`) counts as NOT fresh: a recorder we cannot vouch for must not be able to veto a
 * stop, or a stale process would become unkillable.
 */
export function hasFreshRecordingData(camera = {}, processStatus = {}, now = Date.now()) {
    const lastDataAt = Number(processStatus?.lastDataAt);
    if (!Number.isFinite(lastDataAt) || lastDataAt <= 0) {
        return false;
    }
    const timeout = camera?.is_tunnel === 1
        ? RECORDING_HEALTH_TIMEOUT_TUNNEL_MS
        : RECORDING_HEALTH_TIMEOUT_INTERNAL_MS;
    return (now - lastDataAt) <= timeout;
}

export function isRecordableCamera(camera = {}) {
    return isEnabled(camera.enabled)
        && isEnabled(camera.enable_recording)
        && RECORDABLE_DELIVERY_TYPES.has(camera.delivery_type);
}

export function decideRecordingLifecycleAction({
    camera,
    processStatus = {},
    recordingStatus = {},
    now = Date.now(),
} = {}) {
    if (!camera) {
        return { action: 'noop_missing', reason: 'camera_missing' };
    }

    if (!isEnabled(camera.enabled) || !isEnabled(camera.enable_recording)) {
        if (!isStopped(processStatus)) {
            return { action: 'stop_disabled', reason: 'camera_or_recording_disabled' };
        }
        return { action: 'noop_disabled', reason: 'camera_or_recording_disabled' };
    }

    if (!RECORDABLE_DELIVERY_TYPES.has(camera.delivery_type)) {
        if (!isStopped(processStatus)) {
            return { action: 'stop_unrecordable', reason: 'delivery_not_recordable' };
        }
        return { action: 'noop_unrecordable', reason: 'delivery_not_recordable' };
    }

    if (!isEnabled(camera.is_online)) {
        if (!isStopped(processStatus)) {
            /*
             * "Offline" is a verdict about LIVE viewability, and it is reached without ever asking
             * the recorder. That gap cost real footage on 2026-08-19: cameras 7 and 8 filled their
             * session tables with zombie connections, so MediaMTX and the health probe were both
             * refused — while the recorder, holding a session opened earlier, kept pulling video
             * and closing segments normally. Health called that offline, and this branch then
             * stopped the one connection that still worked. On a camera whose session table is
             * full, that slot cannot be won back.
             *
             * So a recorder that is demonstrably still being fed outlives the offline verdict. The
             * camera stays offline for viewers (honest: live really is unreachable) but keeps
             * recording. The moment the feed actually stops, lastDataAt goes stale within 30s and
             * the next reconcile pass stops it for real — no process is made immortal.
             *
             * The recording health monitor already behaves this way (its offline-stop sits below a
             * freshness gate); this makes the 60s reconciler agree instead of overruling it.
             */
            if (hasFreshRecordingData(camera, processStatus, now)) {
                return { action: 'noop_recording_offline_but_fed', reason: 'camera_offline_but_recorder_fed' };
            }
            return { action: 'stop_offline', reason: 'camera_offline' };
        }
        return { action: 'noop_not_online', reason: 'camera_offline_stopped' };
    }

    if (!isStopped(processStatus)) {
        return { action: 'noop_recording', reason: 'process_not_stopped' };
    }

    const cooldownUntil = Number(recordingStatus.cooldownUntil || 0);
    const suspendedReason = recordingStatus.suspendedReason || null;

    if (cooldownUntil > now && suspendedReason !== 'camera_offline') {
        return {
            action: 'wait_cooldown',
            reason: 'cooldown_active',
            cooldownUntil,
            suspendedReason,
        };
    }

    return {
        action: 'start',
        reason: suspendedReason === 'camera_offline'
            ? 'camera_back_online'
            : 'eligible_online_stopped',
        clearCooldown: suspendedReason === 'camera_offline' || suspendedReason === null,
    };
}
