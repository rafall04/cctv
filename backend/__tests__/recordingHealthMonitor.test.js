/**
 * Purpose: Validate recording health monitor state transitions and tick behavior.
 * Caller: Vitest backend suite.
 * Deps: createRecordingHealthMonitor with injected processManager, queryOne, start/stop/restart callbacks.
 * MainFuncs: ensureState/clearState, markRecovered/markFailure/suspendOffline, attemptRecovery,
 *             handleCameraBecame*, tick, late-binding api spy.
 * SideEffects: None; collaborators mocked. Uses fake timers for start/stop loop test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeCooldownMs, createRecordingHealthMonitor } from '../services/recordingHealthMonitor.js';

function createDeps(overrides = {}) {
    const processStatus = { status: 'recording', isRecording: true };
    const processManager = {
        getStatus: vi.fn(() => processStatus),
    };
    const queryOne = vi.fn();
    const startRecording = vi.fn().mockResolvedValue({ success: true });
    const stopRecording = vi.fn().mockResolvedValue({ success: true });
    const restartRecording = vi.fn().mockResolvedValue({ success: true });
    const logger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() };

    return {
        processStatus,
        processManager,
        queryOne,
        startRecording,
        stopRecording,
        restartRecording,
        logger,
        deps: {
            processManager,
            queryOne,
            startRecording,
            stopRecording,
            restartRecording,
            isShuttingDown: () => false,
            logger,
            ...overrides,
        },
    };
}

describe('recordingHealthMonitor — pure helpers', () => {
    it('computeCooldownMs grows exponentially with a cap', () => {
        expect(computeCooldownMs(0)).toBe(15000);
        expect(computeCooldownMs(1)).toBe(15000);
        expect(computeCooldownMs(2)).toBe(30000);
        expect(computeCooldownMs(3)).toBe(60000);
        expect(computeCooldownMs(10)).toBe(5 * 60 * 1000);
    });

    it('rejects construction missing required callbacks', () => {
        expect(() => createRecordingHealthMonitor({})).toThrow(/startRecording/);
        expect(() => createRecordingHealthMonitor({ startRecording: () => {} })).toThrow(/stopRecording/);
        expect(() => createRecordingHealthMonitor({ startRecording: () => {}, stopRecording: () => {} }))
            .toThrow(/restartRecording/);
    });
});

describe('recordingHealthMonitor — state transitions', () => {
    it('ensureState creates a default entry once and returns the same reference', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        const first = monitor.ensureState(7);
        const second = monitor.ensureState(7);
        expect(first).toBe(second);
        expect(first).toMatchObject({ consecutiveFailureCount: 0, suspendedReason: null });
    });

    it('clearState removes entry', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7);
        monitor.clearState(7);
        expect(monitor.getState(7)).toBeNull();
    });

    it('markFailure increments count, sets cooldown, and marks waiting_retry above threshold', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor({ ...deps, now: () => 1000 });
        monitor.markFailure(7, 'process_crashed', 1000);
        expect(monitor.getState(7)).toMatchObject({
            consecutiveFailureCount: 1,
            suspendedReason: 'process_crashed',
            cooldownUntil: 1000 + 15000,
        });
        monitor.markFailure(7, 'process_crashed', 2000);
        monitor.markFailure(7, 'process_crashed', 3000);
        expect(monitor.getState(7).suspendedReason).toBe('waiting_retry');
    });

    it('markRecovered resets failures and clears suspension', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.markFailure(7, 'process_crashed', 1000);
        monitor.markRecovered(7, 5000);
        expect(monitor.getState(7)).toMatchObject({
            consecutiveFailureCount: 0,
            cooldownUntil: 0,
            suspendedReason: null,
            lastDataTime: 5000,
        });
    });

    it('markStarted refreshes data time but preserves the failure counter', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.markFailure(7, 'stream_frozen', 1000);
        monitor.markStarted(7, 5000);
        expect(monitor.getState(7)).toMatchObject({
            lastDataTime: 5000,
            consecutiveFailureCount: 1,
            inFlightAction: false,
        });
    });

    it('suspendOffline sets cooldown floor and suspended reason without lowering existing cooldown', () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.markFailure(7, 'crashed', 1000); // cooldownUntil 16000
        monitor.suspendOffline(7, 2000); // would set 2000 + 60000 = 62000, > 16000
        expect(monitor.getState(7).cooldownUntil).toBe(62000);
        monitor.suspendOffline(7, 500); // would set 60500, < existing 62000 → unchanged
        expect(monitor.getState(7).cooldownUntil).toBe(62000);
        expect(monitor.getState(7).suspendedReason).toBe('camera_offline');
    });
});

describe('recordingHealthMonitor.attemptRecovery', () => {
    it('skips when in-flight action or cooldown active', async () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7).cooldownUntil = 5000;
        const result = await monitor.attemptRecovery(7, 'waiting_retry', 1000);
        expect(result).toMatchObject({ success: false, skipped: true, reason: 'cooldown_active' });
        expect(deps.startRecording).not.toHaveBeenCalled();
    });

    it('calls startRecording and marks the process started on success', async () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        const result = await monitor.attemptRecovery(7, 'waiting_retry', 1000);
        expect(result).toEqual({ success: true });
        expect(deps.startRecording).toHaveBeenCalledWith(7);
        expect(monitor.getState(7).suspendedReason).toBeNull();
    });

    it('does NOT clear an existing failure count on start success (recovery is probationary)', async () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor(deps);
        monitor.markFailure(7, 'stream_frozen', 1000);
        monitor.markFailure(7, 'stream_frozen', 2000); // count=2, cooldownUntil=2000+30000
        await monitor.attemptRecovery(7, 'waiting_retry', 100000);
        expect(deps.startRecording).toHaveBeenCalledWith(7);
        expect(monitor.getState(7).consecutiveFailureCount).toBe(2);
    });

    it('marks failure when startRecording reports !success', async () => {
        const { deps, startRecording } = createDeps();
        startRecording.mockResolvedValueOnce({ success: false, message: 'no source' });
        const monitor = createRecordingHealthMonitor(deps);
        await monitor.attemptRecovery(7, 'spawn_error', 1000);
        expect(monitor.getState(7).consecutiveFailureCount).toBe(1);
    });
});

describe('recordingHealthMonitor.tick', () => {
    it('clears state for cameras that no longer exist in DB', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'stopped' });
        queryOne.mockReturnValue(null);
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7);

        await monitor.tick(10_000);

        expect(monitor.getState(7)).toBeNull();
    });

    it('attempts recovery on stopped + online + suspended after cooldown', async () => {
        const { deps, processManager, queryOne, startRecording } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'stopped' });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.suspendedReason = 'waiting_retry';
        state.cooldownUntil = 1000;

        await monitor.tick(5000);

        expect(startRecording).toHaveBeenCalledWith(7);
    });

    it('suspends offline when process stopped and camera is_online=0', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'stopped' });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 0, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7);

        await monitor.tick(5000);

        expect(monitor.getState(7).suspendedReason).toBe('camera_offline');
    });

    it('restarts a frozen recording past the timeout', async () => {
        const { deps, processManager, queryOne, restartRecording } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.lastDataTime = 0; // very old

        await monitor.tick(60_000);

        expect(restartRecording).toHaveBeenCalledWith(7, 'stream_frozen');
        expect(monitor.getState(7).restartCount).toBe(1);
    });

    it('suspends (stops, does not restart) after N consecutive frozen failures', async () => {
        const { deps, processManager, queryOne, stopRecording, restartRecording } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.lastDataTime = 0;
        state.consecutiveFailureCount = 2; // one more freeze reaches the suspend threshold (3)

        await monitor.tick(60_000);

        expect(restartRecording).not.toHaveBeenCalled();
        expect(stopRecording).toHaveBeenCalledWith(7, { removeHealthState: false, reason: 'stream_frozen' });
        expect(monitor.getState(7).consecutiveFailureCount).toBe(3);
        expect(monitor.getState(7).suspendedReason).toBe('waiting_retry');
    });

    it('caps the no-media cooldown so a recovered camera resumes quickly', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.lastDataTime = 0;
        state.consecutiveFailureCount = 3; // next freeze -> count 4 -> uncapped cooldown would be 120s

        await monitor.tick(1_000_000);

        // computeCooldownMs(4) = 120_000, but capped to RECORDING_NO_MEDIA_MAX_COOLDOWN_MS (60_000).
        expect(monitor.getState(7).cooldownUntil).toBe(1_000_000 + 60_000);
    });

    it('clears the failure count after sustained healthy data since the last restart', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.consecutiveFailureCount = 2;
        state.lastRestartAt = 1000;
        state.lastDataTime = 100_000; // data fresh at tick time

        await monitor.tick(100_000); // healthy, and 99_000ms since restart exceeds the confirm window

        expect(monitor.getState(7).consecutiveFailureCount).toBe(0);
        expect(monitor.getState(7).suspendedReason).toBeNull();
    });

    it('does not clear the failure count until the recovery-confirm window passes', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.consecutiveFailureCount = 2;
        state.lastRestartAt = 90_000;
        state.lastDataTime = 100_000;

        await monitor.tick(100_000); // only 10_000ms since restart — below the confirm window

        expect(monitor.getState(7).consecutiveFailureCount).toBe(2);
    });

    it('stops recording + suspends offline when frozen but camera confirmed offline', async () => {
        const { deps, processManager, queryOne, stopRecording, restartRecording } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'recording', isRecording: true });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 0, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        const state = monitor.ensureState(7);
        state.lastDataTime = 0;

        await monitor.tick(60_000);

        expect(stopRecording).toHaveBeenCalledWith(7, { removeHealthState: false });
        expect(restartRecording).not.toHaveBeenCalled();
        expect(monitor.getState(7).suspendedReason).toBe('camera_offline');
    });

    it('respects isShuttingDown by no-op', async () => {
        const { deps, processManager } = createDeps({ isShuttingDown: () => true });
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7);
        await monitor.tick(1000);
        expect(processManager.getStatus).not.toHaveBeenCalled();
    });

    it('tick uses late-binding api so vi.spyOn(monitor, "attemptRecovery") intercepts internal calls', async () => {
        const { deps, processManager, queryOne } = createDeps();
        processManager.getStatus.mockReturnValue({ status: 'stopped' });
        queryOne.mockReturnValue({ is_tunnel: 0, is_online: 1, enabled: 1, enable_recording: 1 });
        const monitor = createRecordingHealthMonitor(deps);
        monitor.ensureState(7).suspendedReason = 'waiting_retry';
        const spy = vi.spyOn(monitor, 'attemptRecovery').mockResolvedValue({ success: false, skipped: true });

        await monitor.tick(99_999);

        expect(spy).toHaveBeenCalledWith(7, 'waiting_retry', 99_999);
    });
});

describe('recordingHealthMonitor.start/stop', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('start() schedules tick at the configured interval, stop() halts it', async () => {
        const { deps } = createDeps();
        const monitor = createRecordingHealthMonitor({ ...deps, tickIntervalMs: 500 });
        const tickSpy = vi.spyOn(monitor, 'tick').mockResolvedValue(undefined);

        monitor.start();
        await vi.advanceTimersByTimeAsync(500);
        expect(tickSpy).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(500);
        expect(tickSpy).toHaveBeenCalledTimes(2);

        monitor.stop();
        await vi.advanceTimersByTimeAsync(2000);
        expect(tickSpy).toHaveBeenCalledTimes(2);
    });
});
