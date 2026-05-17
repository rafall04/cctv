// Purpose: Decide desired recording lifecycle actions from camera and process state.
// Caller: recordingLifecycleReconciler and focused policy tests.
// Deps: None.
// MainFuncs: isRecordableCamera, decideRecordingLifecycleAction.
// SideEffects: None; pure policy only.

const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

function isEnabled(value) {
    return value === 1 || value === true;
}

function isStopped(processStatus = {}) {
    return !processStatus || processStatus.status === 'stopped';
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
        return { action: 'noop_disabled', reason: 'camera_or_recording_disabled' };
    }

    if (!RECORDABLE_DELIVERY_TYPES.has(camera.delivery_type)) {
        return { action: 'noop_unrecordable', reason: 'delivery_not_recordable' };
    }

    if (!isEnabled(camera.is_online)) {
        if (!isStopped(processStatus)) {
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
