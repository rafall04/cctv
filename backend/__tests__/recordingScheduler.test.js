/**
 * Purpose: Validate RecordingScheduler register/start/stop/telemetry behavior.
 * Caller: Vitest backend test suite.
 * Deps: recordingScheduler with fake timers.
 * MainFuncs: register, start, stop, getTaskStats, getAllStats.
 * SideEffects: Uses fake timers; no real I/O.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RecordingScheduler } from '../services/recordingScheduler.js';

describe('RecordingScheduler', () => {
    let scheduler;

    beforeEach(() => {
        vi.useFakeTimers();
        scheduler = new RecordingScheduler();
    });

    afterEach(() => {
        scheduler.stop();
        vi.useRealTimers();
    });

    it('runs a registered task on its interval and tracks telemetry', async () => {
        const task = vi.fn().mockResolvedValue(undefined);
        scheduler.register({ name: 'demo', task, intervalMs: 1000, initialDelayMs: 500 });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(500);
        expect(task).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(2);

        const stats = scheduler.getTaskStats('demo');
        expect(stats.runCount).toBe(2);
        expect(stats.lastError).toBeNull();
        expect(stats.intervalMs).toBe(1000);
    });

    it('records last error without stopping the loop', async () => {
        const task = vi.fn()
            .mockRejectedValueOnce(new Error('boom'))
            .mockResolvedValueOnce(undefined);
        scheduler.register({ name: 'flaky', task, intervalMs: 500 });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(500);
        expect(scheduler.getTaskStats('flaky').lastError).toBe('boom');

        await vi.advanceTimersByTimeAsync(500);
        expect(task).toHaveBeenCalledTimes(2);
        expect(scheduler.getTaskStats('flaky').lastError).toBeNull();
    });

    it('stop() cancels future task runs', async () => {
        const task = vi.fn().mockResolvedValue(undefined);
        scheduler.register({ name: 'stoppable', task, intervalMs: 200 });
        scheduler.start();

        await vi.advanceTimersByTimeAsync(200);
        expect(task).toHaveBeenCalledTimes(1);

        scheduler.stop();
        await vi.advanceTimersByTimeAsync(1000);
        expect(task).toHaveBeenCalledTimes(1);
    });

    it('rejects invalid registration inputs', () => {
        expect(() => scheduler.register({ name: '', task: () => {}, intervalMs: 100 })).toThrow();
        expect(() => scheduler.register({ name: 'a', task: 'not-a-fn', intervalMs: 100 })).toThrow();
        expect(() => scheduler.register({ name: 'a', task: () => {}, intervalMs: 0 })).toThrow();
    });

    it('getAllStats lists every registered task', () => {
        scheduler.register({ name: 'a', task: () => {}, intervalMs: 100 });
        scheduler.register({ name: 'b', task: () => {}, intervalMs: 200 });
        const stats = scheduler.getAllStats();
        expect(stats).toHaveLength(2);
        expect(stats.map((s) => s.name).sort()).toEqual(['a', 'b']);
    });
});
