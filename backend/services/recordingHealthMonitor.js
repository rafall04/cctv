// Purpose: Track per-camera recording health (data freshness, cooldowns, suspend reasons) and drive restart/recovery.
// Caller: recordingService facade (constructor wires the monitor; lifecycle/playback queries surface state).
// Deps: recordingProcessManager (process state), recording intervals policy (timeouts/cooldowns).
// MainFuncs: createRecordingHealthMonitor → { ensureState, clearState, markRecovered, markFailure, suspendOffline,
//             attemptRecovery, handleCameraBecameOffline, handleCameraBecameOnline, tick, start, stop,
//             getSnapshot, computeCooldownMs }.
// SideEffects: Maintains in-memory streamHealthMap; invokes injected recordingService start/stop methods on tick.

import recordingProcessManagerDefault from './recordingProcessManager.js';
import { queryOne as defaultQueryOne } from '../database/connectionPool.js';
import {
    RECORDING_FAILURE_SUSPEND_THRESHOLD,
    RECORDING_HEALTH_TICK_INTERVAL_MS,
    RECORDING_HEALTH_TIMEOUT_INTERNAL_MS,
    RECORDING_HEALTH_TIMEOUT_TUNNEL_MS,
    RECORDING_NO_MEDIA_MAX_COOLDOWN_MS,
    RECORDING_OFFLINE_COOLDOWN_MS,
    RECORDING_RECOVERY_CONFIRM_MS,
    RECORDING_RETRY_BASE_COOLDOWN_MS,
    RECORDING_RETRY_MAX_COOLDOWN_MS,
} from './recordingIntervalsPolicy.js';

export function computeCooldownMs(consecutiveFailureCount = 0) {
    if (consecutiveFailureCount <= 1) {
        return RECORDING_RETRY_BASE_COOLDOWN_MS;
    }
    const exponent = Math.max(0, consecutiveFailureCount - 1);
    return Math.min(
        RECORDING_RETRY_BASE_COOLDOWN_MS * (2 ** exponent),
        RECORDING_RETRY_MAX_COOLDOWN_MS
    );
}

function emptyHealth(nowMs) {
    return {
        lastDataTime: nowMs,
        restartCount: 0,
        consecutiveFailureCount: 0,
        cooldownUntil: 0,
        suspendedReason: null,
        lastRestartAt: null,
        inFlightAction: false,
    };
}

export function createRecordingHealthMonitor({
    processManager = recordingProcessManagerDefault,
    queryOne = defaultQueryOne,
    startRecording,
    stopRecording,
    restartRecording,
    isShuttingDown = () => false,
    tickIntervalMs = RECORDING_HEALTH_TICK_INTERVAL_MS,
    logger = console,
    now = () => Date.now(),
} = {}) {
    if (typeof startRecording !== 'function') {
        throw new Error('recordingHealthMonitor requires startRecording function');
    }
    if (typeof stopRecording !== 'function') {
        throw new Error('recordingHealthMonitor requires stopRecording function');
    }
    if (typeof restartRecording !== 'function') {
        throw new Error('recordingHealthMonitor requires restartRecording function');
    }

    const streamHealthMap = new Map();
    let tickHandle = null;
    // Late-binding object: every internal cross-call goes through `api.x` so that
    // tests can spy on a method by replacing `api.x` after construction.
    const api = {};

    function ensureState(cameraId) {
        const existing = streamHealthMap.get(cameraId);
        if (existing) return existing;
        const next = emptyHealth(now());
        streamHealthMap.set(cameraId, next);
        return next;
    }

    function clearState(cameraId) {
        streamHealthMap.delete(cameraId);
    }

    function getState(cameraId) {
        return streamHealthMap.get(cameraId) || null;
    }

    function updateLastDataAt(cameraId, nowMs = now()) {
        const state = streamHealthMap.get(cameraId);
        if (state) state.lastDataTime = nowMs;
    }

    function markRecovered(cameraId, nowMs = now()) {
        const state = ensureState(cameraId);
        state.lastDataTime = nowMs;
        state.consecutiveFailureCount = 0;
        state.cooldownUntil = 0;
        state.suspendedReason = null;
        state.inFlightAction = false;
        return state;
    }

    // Called when a recording process is (re)spawned. Spawning is NOT proof the
    // camera is delivering video, so — unlike markRecovered — this preserves the
    // failure counter/cooldown/suspend reason. Recovery is only confirmed later,
    // once data has flowed for RECORDING_RECOVERY_CONFIRM_MS (see tick). This is
    // what lets the circuit-breaker accumulate against a camera that pings but
    // sends no frames, instead of resetting on every restart.
    function markStarted(cameraId, nowMs = now()) {
        const state = ensureState(cameraId);
        state.lastDataTime = nowMs;
        state.inFlightAction = false;
        return state;
    }

    function markFailure(cameraId, reason = 'process_crashed', nowMs = now()) {
        const state = ensureState(cameraId);
        state.consecutiveFailureCount += 1;
        state.lastRestartAt = nowMs;
        state.inFlightAction = false;
        state.cooldownUntil = nowMs + computeCooldownMs(state.consecutiveFailureCount);
        state.suspendedReason = state.consecutiveFailureCount >= RECORDING_FAILURE_SUSPEND_THRESHOLD
            ? 'waiting_retry'
            : reason;
        return state;
    }

    function suspendOffline(cameraId, nowMs = now()) {
        const state = ensureState(cameraId);
        state.cooldownUntil = Math.max(state.cooldownUntil || 0, nowMs + RECORDING_OFFLINE_COOLDOWN_MS);
        state.suspendedReason = 'camera_offline';
        state.inFlightAction = false;
        return state;
    }

    async function attemptRecovery(cameraId, reason = 'waiting_retry', nowMs = now()) {
        const state = ensureState(cameraId);
        if (state.inFlightAction || nowMs < (state.cooldownUntil || 0)) {
            return { success: false, skipped: true, reason: 'cooldown_active' };
        }
        state.inFlightAction = true;
        try {
            const result = await startRecording(cameraId);
            if (result.success) {
                // Process started — recovery stays probationary until data flows.
                markStarted(cameraId, nowMs);
            } else {
                markFailure(cameraId, reason, nowMs);
            }
            return result;
        } finally {
            const latest = streamHealthMap.get(cameraId);
            if (latest) latest.inFlightAction = false;
        }
    }

    async function handleCameraBecameOffline(cameraId, nowMs = now()) {
        suspendOffline(cameraId, nowMs);
        if (processManager.getStatus(cameraId).status !== 'stopped') {
            await stopRecording(cameraId, { removeHealthState: false, reason: 'camera_offline' });
        }
    }

    async function handleCameraBecameOnline(cameraId, nowMs = now(), { clearCooldown = true } = {}) {
        if (processManager.getStatus(cameraId).status !== 'stopped') {
            return null;
        }
        const state = ensureState(cameraId);
        if (!state.suspendedReason) state.suspendedReason = 'waiting_retry';
        if (clearCooldown) state.cooldownUntil = 0;
        return attemptRecovery(cameraId, state.suspendedReason, nowMs);
    }

    async function tick(nowMs = now()) {
        if (isShuttingDown()) return;

        for (const [cameraId, state] of streamHealthMap.entries()) {
            const camera = queryOne(
                'SELECT is_tunnel, is_online, enabled, enable_recording, recording_status FROM cameras WHERE id = ?',
                [cameraId]
            );

            if (!camera) {
                api.clearState(cameraId);
                continue;
            }

            if (!camera.enabled || !camera.enable_recording) {
                if (processManager.getStatus(cameraId).status === 'stopped') {
                    api.clearState(cameraId);
                }
                continue;
            }

            const processStatus = processManager.getStatus(cameraId);
            if (processStatus.status === 'stopped') {
                if (camera.is_online === 1 && state.suspendedReason && nowMs >= (state.cooldownUntil || 0)) {
                    await api.attemptRecovery(cameraId, state.suspendedReason, nowMs);
                } else if (camera.is_online !== 1) {
                    api.suspendOffline(cameraId, nowMs);
                }
                continue;
            }

            if (state.inFlightAction) continue;

            const timeout = camera.is_tunnel === 1
                ? RECORDING_HEALTH_TIMEOUT_TUNNEL_MS
                : RECORDING_HEALTH_TIMEOUT_INTERNAL_MS;
            const timeSinceData = nowMs - state.lastDataTime;
            if (timeSinceData <= timeout) {
                // Data is flowing. Confirm recovery only after the stream has stayed
                // healthy for a sustained window since the last restart — a freshly
                // spawned process that has not proven itself must not clear the breaker.
                if (state.consecutiveFailureCount > 0
                    && (nowMs - (state.lastRestartAt || 0)) >= RECORDING_RECOVERY_CONFIRM_MS) {
                    api.markRecovered(cameraId, nowMs);
                }
                continue;
            }

            if (camera.is_online !== 1) {
                logger.log?.(`[Recording Health] Camera ${cameraId} confirmed offline, suspending recording recovery`);
                api.suspendOffline(cameraId, nowMs);
                await stopRecording(cameraId, { removeHealthState: false });
                continue;
            }

            if (nowMs < (state.cooldownUntil || 0)) continue;

            // Count the freeze as a failure so the circuit-breaker engages: markFailure
            // sets an exponential cooldown and, past the threshold, a suspend reason.
            // Without this, a camera that pings but sends no video would be restarted
            // every ~35s forever, flooding pending/ with empty partials.
            state.restartCount += 1;
            api.markFailure(cameraId, 'stream_frozen', nowMs);
            const failed = streamHealthMap.get(cameraId);
            if (failed) {
                // No-media backoff is bounded low so a recovered camera resumes
                // recording within ~1 min, instead of backing off to the 5-min cap.
                failed.cooldownUntil = Math.min(
                    failed.cooldownUntil,
                    nowMs + RECORDING_NO_MEDIA_MAX_COOLDOWN_MS
                );
            }

            if (failed && failed.consecutiveFailureCount >= RECORDING_FAILURE_SUSPEND_THRESHOLD) {
                // Stop hammering: suspend and let the stopped-branch retry on the (now
                // exponentially longer) cooldown that markFailure already set.
                logger.log?.(`[Recording Health] Camera ${cameraId} frozen ${failed.consecutiveFailureCount}× (no media) — suspending recording restarts`);
                await stopRecording(cameraId, { removeHealthState: false, reason: 'stream_frozen' });
                continue;
            }

            logger.log?.(`⚠️ Camera ${cameraId} stream frozen (${timeSinceData}ms), restarting (attempt ${failed?.consecutiveFailureCount ?? state.restartCount})...`);
            state.inFlightAction = true;
            try {
                await restartRecording(cameraId, 'stream_frozen');
            } finally {
                const latest = streamHealthMap.get(cameraId);
                if (latest) latest.inFlightAction = false;
            }
        }
    }

    function start() {
        if (tickHandle) return;
        tickHandle = setInterval(() => {
            api.tick().catch((error) => logger.error?.('[Recording Health] Error during monitor tick:', error));
        }, tickIntervalMs);
    }

    function stop() {
        if (tickHandle) {
            clearInterval(tickHandle);
            tickHandle = null;
        }
    }

    function getSnapshot(cameraId) {
        const state = streamHealthMap.get(cameraId);
        return state ? { ...state } : null;
    }

    Object.assign(api, {
        ensureState,
        clearState,
        getState,
        updateLastDataAt,
        markRecovered,
        markStarted,
        markFailure,
        suspendOffline,
        attemptRecovery,
        handleCameraBecameOffline,
        handleCameraBecameOnline,
        tick,
        start,
        stop,
        getSnapshot,
        computeCooldownMs,
    });
    return api;
}
