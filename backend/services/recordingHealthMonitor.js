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
        // One "don't punish a camera for the outage it just left" reset is available per outage.
        // suspendOffline() re-arms it; handleCameraBecameOnline() consumes it. Starts armed so a
        // camera whose state is rebuilt (boot, adoption) still gets its one fast retry.
        offlineResetPending: true,
        // Segment count captured at the last (re)start. Recovery from a freeze is confirmed only
        // once the live count exceeds this — see tick(). null until the first markStarted.
        segmentBaseline: null,
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
    // How many finalized segments a camera has. Recovery from a freeze is confirmed by this
    // increasing since (re)start — a completed segment is real proof of recording, unlike stderr
    // bytes, which a frozen stream still produces. Injectable so the monitor stays unit-testable.
    countSegments = (cameraId) => {
        const row = queryOne('SELECT COUNT(*) AS n FROM recording_segments WHERE camera_id = ?', [cameraId]);
        return row?.n ?? 0;
    },
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
        // Snapshot the segment count now so tick() can confirm recovery by a COMPLETED segment
        // appearing after this (re)start, rather than by stderr bytes a frozen stream also emits.
        state.segmentBaseline = api.countSegments(cameraId);
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
        // Arms the ONE failure-count reset this outage is entitled to. See handleCameraBecameOnline.
        state.offlineResetPending = true;
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
        if (clearCooldown) {
            state.cooldownUntil = 0;
            // Reset the breaker too, not just the cooldown.
            //
            // Those failures were caused by the camera being OFFLINE, and that cause is
            // now gone. Carrying the count forward punishes a camera for an outage it
            // has already recovered from: a device that just rebooted usually is not
            // serving RTSP yet for the first seconds, so attempt #1 fails, and a stale
            // count of 7+ puts the next try 5 MINUTES away (15s doubling, capped at 5m).
            // Clearing it means a rebooted camera retries in 15s instead.
            //
            // This does NOT reopen the hole the breaker exists for. That hole is a
            // camera which pings but sends no frames — it never leaves the online
            // state, so no offline->online transition fires, this branch never runs,
            // and its count keeps climbing until the breaker suspends it.
            //
            // BUT the reset must be consumed ONCE PER OUTAGE, not on every reconcile. Without the
            // flag this branch is re-entered every 60s: markFailure re-stamps suspendedReason to
            // 'camera_offline' whenever the count is below the threshold, and
            // recordingLifecyclePolicy treats that value as "bypass cooldown + clearCooldown", so
            // the reconciler calls back in here, zeroes the count again, and the count is pinned
            // at 1 forever. The breaker could then never reach RECORDING_FAILURE_SUSPEND_THRESHOLD
            // and ffmpeg was respawned every 60s indefinitely — the orphan-ffmpeg storm the
            // breaker exists to stop. suspendOffline() re-arms this on the next genuine outage.
            if (state.offlineResetPending) {
                state.consecutiveFailureCount = 0;
                state.offlineResetPending = false;
            }
        }
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
                // Data is flowing. But "data" here is only that the stderr tailer saw bytes, and a
                // frozen stream still spews error chatter — so time-alone is not proof of recovery.
                const confirmWindowPassed = (nowMs - (state.lastRestartAt || 0)) >= RECORDING_RECOVERY_CONFIRM_MS;

                if (state.consecutiveFailureCount > 0) {
                    // A camera carrying failures must prove recovery with a COMPLETED segment, not
                    // stderr bytes. The old time-only reset zeroed the breaker every ~45s — shorter
                    // than the 600s a segment takes — so a stream that streamed briefly then re-froze
                    // never reached the suspend threshold. Production symptom: camera 37 restarting
                    // every 45-75s forever, each logged a success, while producing nothing. A new
                    // segment since (re)start is the real signal that it can actually record.
                    if (confirmWindowPassed
                        && state.segmentBaseline != null
                        && api.countSegments(cameraId) > state.segmentBaseline) {
                        api.markRecovered(cameraId, nowMs);
                    }
                } else if (state.suspendedReason && confirmWindowPassed) {
                    // Count is already 0 (e.g. cleared on an offline→online transition, which resets
                    // the counter but leaves suspendedReason set). No breaker to protect here, so
                    // clearing the lingering reason once data flows is pure status honesty — markRecovered
                    // is the only writer that clears suspendedReason, and without this a camera that
                    // recovered from an outage reads as 'suspended_offline' until it next stops.
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
            if (failed && failed.consecutiveFailureCount < RECORDING_FAILURE_SUSPEND_THRESHOLD) {
                // A brief blip retries briskly: bound the no-media backoff low so a camera that
                // recovers on its own resumes within ~1 min instead of the 5-min cap. But once the
                // breaker has tripped (count reached the suspend threshold — a persistently dead
                // source), stop clamping and let the exponential backoff stand, so a dead upstream is
                // polled at the 5-min cap rather than hammered every 60s (prod: 1,889 restarts/24h).
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
        countSegments,
    });
    return api;
}
