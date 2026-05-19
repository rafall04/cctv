/**
 * Purpose: Validate generic bounded-concurrency queue: dedup, concurrency cap, drain, stats.
 * Caller: Vitest backend suite.
 * Deps: createRecordingRecoveryQueue (pure; runJob + keyFn injected).
 * MainFuncs: enqueue, isOwned, drain, getStats.
 * SideEffects: None.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingRecoveryQueue } from '../services/recordingRecoveryQueue.js';

const keyFn = (input) => `${input.cameraId}:${input.filename}`;

describe('createRecordingRecoveryQueue', () => {
    it('rejects construction missing runJob or keyFn', () => {
        expect(() => createRecordingRecoveryQueue({ keyFn })).toThrow(/runJob/);
        expect(() => createRecordingRecoveryQueue({ runJob: () => {} })).toThrow(/keyFn/);
    });

    it('runs a job and resolves with the runJob return value', async () => {
        const runJob = vi.fn().mockResolvedValue({ success: true, finalFilename: 'x.mp4' });
        const queue = createRecordingRecoveryQueue({ runJob, keyFn });

        const result = await queue.enqueue({ cameraId: 1, filename: 'a.mp4' });

        expect(result).toEqual({ success: true, finalFilename: 'x.mp4' });
        expect(runJob).toHaveBeenCalledTimes(1);
    });

    it('dedupes concurrent enqueues with the same key (single runJob call, both promises resolve)', async () => {
        let resolveRun;
        const runJob = vi.fn(() => new Promise((resolve) => { resolveRun = resolve; }));
        const queue = createRecordingRecoveryQueue({ runJob, keyFn });

        const p1 = queue.enqueue({ cameraId: 1, filename: 'a.mp4' });
        const p2 = queue.enqueue({ cameraId: 1, filename: 'a.mp4' });

        expect(runJob).toHaveBeenCalledTimes(1);
        resolveRun({ success: true });
        const [r1, r2] = await Promise.all([p1, p2]);
        expect(r1).toEqual({ success: true });
        expect(r2).toEqual({ success: true });
    });

    it('enforces maxConcurrent — at most N jobs run in parallel', async () => {
        const runningKeys = new Set();
        let peak = 0;
        const runJob = vi.fn(async (input) => {
            const key = keyFn(input);
            runningKeys.add(key);
            peak = Math.max(peak, runningKeys.size);
            await new Promise((resolve) => setTimeout(resolve, 30));
            runningKeys.delete(key);
            return { success: true };
        });
        const queue = createRecordingRecoveryQueue({ runJob, keyFn, maxConcurrent: 2 });

        const promises = [];
        for (let i = 0; i < 6; i += 1) {
            promises.push(queue.enqueue({ cameraId: i, filename: 'a.mp4' }));
        }
        await Promise.all(promises);

        expect(peak).toBe(2);
        expect(runJob).toHaveBeenCalledTimes(6);
    });

    it('resolves with an error sentinel when runJob throws', async () => {
        const runJob = vi.fn(() => { throw new Error('boom'); });
        const queue = createRecordingRecoveryQueue({ runJob, keyFn });

        const result = await queue.enqueue({ cameraId: 1, filename: 'x.mp4' });

        expect(result).toMatchObject({ success: false, terminal: false, reason: 'boom' });
    });

    it('isOwned reflects queued + in-flight, clears after job completes', async () => {
        let resolveRun;
        const runJob = vi.fn(() => new Promise((resolve) => { resolveRun = resolve; }));
        const queue = createRecordingRecoveryQueue({ runJob, keyFn, maxConcurrent: 1 });

        const promise = queue.enqueue({ cameraId: 1, filename: 'a.mp4' });
        expect(queue.isOwned('1:a.mp4')).toBe(true);
        resolveRun({ success: true });
        await promise;
        expect(queue.isOwned('1:a.mp4')).toBe(false);
    });

    it('drain resolves when all jobs complete', async () => {
        const runJob = vi.fn(async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
            return { success: true };
        });
        const queue = createRecordingRecoveryQueue({ runJob, keyFn });

        queue.enqueue({ cameraId: 1, filename: 'a.mp4' });
        queue.enqueue({ cameraId: 2, filename: 'b.mp4' });
        await expect(queue.drain(5000)).resolves.toBeUndefined();
        expect(runJob).toHaveBeenCalledTimes(2);
    });

    it('drain throws on timeout', async () => {
        const runJob = vi.fn(() => new Promise(() => {})); // never resolves
        const queue = createRecordingRecoveryQueue({ runJob, keyFn, drainPollMs: 5 });

        queue.enqueue({ cameraId: 1, filename: 'a.mp4' });
        await expect(queue.drain(50)).rejects.toThrow(/drain timeout/);
    });

    it('getStats reports queue length, in-flight count, active count, max concurrent', async () => {
        const runJob = vi.fn(() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 20)));
        const queue = createRecordingRecoveryQueue({ runJob, keyFn, maxConcurrent: 1 });

        const p1 = queue.enqueue({ cameraId: 1, filename: 'a.mp4' });
        const p2 = queue.enqueue({ cameraId: 2, filename: 'b.mp4' });
        const stats = queue.getStats();
        expect(stats.maxConcurrent).toBe(1);
        expect(stats.inFlightCount).toBeGreaterThanOrEqual(1);

        await Promise.all([p1, p2]);
    });
});
