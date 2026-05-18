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
    RECORDING_OFFLINE_COOLDOWN_MS,
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
                markRecovered(cameraId, nowMs);
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
            if (timeSinceData <= timeout) continue;

            if (camera.is_online !== 1) {
                logger.log?.(`[Recording Health] Camera ${cameraId} confirmed offline, suspending recording recovery`);
                api.suspendOffline(cameraId, nowMs);
                await stopRecording(cameraId, { removeHealthState: false });
                continue;
            }

            if (nowMs < (state.cooldownUntil || 0)) continue;

            logger.log?.(`⚠️ Camera ${cameraId} stream frozen (${timeSinceData}ms), restarting...`);
            state.restartCount += 1;
            state.lastRestartAt = nowMs;
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
            tick().catch((error) => logger.error?.('[Recording Health] Error during monitor tick:', error));
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
