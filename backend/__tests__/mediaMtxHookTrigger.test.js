/*
 * Purpose: Cover the MediaMTX push-hook coalescing trigger (Phase 3) — debounce per camera, concurrent
 *          in-flight cap, slot release, and the no-op guards. These bounds are what keep a MediaMTX
 *          restart burst from swamping the check function; getting them wrong is a load/DoS bug.
 * Caller:  Backend Vitest suite.
 * Deps:    MediaMtxHookTrigger (pure — injected check + clock).
 */

import { describe, expect, it, vi } from 'vitest';
import MediaMtxHookTrigger from '../services/mediaMtxHookTrigger.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('MediaMtxHookTrigger', () => {
    it('calls check(cameraId) on the first event', async () => {
        const check = vi.fn(() => Promise.resolve());
        const trigger = new MediaMtxHookTrigger({ check, now: () => 1000 });
        trigger.onEvent(5, 'ready');
        await flush();
        expect(check).toHaveBeenCalledTimes(1);
        expect(check).toHaveBeenCalledWith(5);
    });

    it('debounces a rapid repeat for the SAME camera, then allows past the window', async () => {
        let now = 1000;
        const check = vi.fn(() => Promise.resolve());
        const trigger = new MediaMtxHookTrigger({ check, debounceMs: 3000, now: () => now });

        trigger.onEvent(5, 'ready');
        await flush();
        now = 2999; // still within 3s of the first
        trigger.onEvent(5, 'notready');
        await flush();
        expect(check).toHaveBeenCalledTimes(1);

        now = 4001; // beyond the window
        trigger.onEvent(5, 'ready');
        await flush();
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('debounce is PER camera — a different camera is never suppressed', async () => {
        const now = 1000;
        const check = vi.fn(() => Promise.resolve());
        const trigger = new MediaMtxHookTrigger({ check, debounceMs: 3000, now: () => now });
        trigger.onEvent(1, 'ready');
        trigger.onEvent(2, 'ready');
        await flush();
        expect(check).toHaveBeenCalledTimes(2);
    });

    it('caps concurrent in-flight re-checks and frees the slot after one resolves', async () => {
        const resolvers = [];
        const check = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
        // debounceMs 0 + distinct ids => no debounce; isolate the in-flight cap behaviour.
        const trigger = new MediaMtxHookTrigger({ check, maxInflight: 2, debounceMs: 0, now: () => Date.now() });

        trigger.onEvent(1);
        trigger.onEvent(2);
        await flush();
        expect(check).toHaveBeenCalledTimes(2); // both slots taken

        trigger.onEvent(3);
        await flush();
        expect(check).toHaveBeenCalledTimes(2); // shed — cap reached

        resolvers[0](); // free one slot
        await flush();
        trigger.onEvent(4);
        await flush();
        expect(check).toHaveBeenCalledTimes(3); // slot reused
    });

    it('does NOT poison the debounce window when an event is shed by the in-flight cap', async () => {
        let now = 1000;
        const resolvers = [];
        const check = vi.fn(() => new Promise((resolve) => resolvers.push(resolve)));
        const trigger = new MediaMtxHookTrigger({ check, maxInflight: 1, debounceMs: 3000, now: () => now });

        trigger.onEvent(1, 'ready'); // dispatched, holds the only slot (never resolves)
        await flush();
        expect(check).toHaveBeenCalledTimes(1);

        trigger.onEvent(2, 'ready'); // SHED by the cap — must NOT stamp camera 2's debounce timestamp
        await flush();
        expect(check).toHaveBeenCalledTimes(1);

        resolvers[0](); // free the slot
        await flush();

        now = 2000; // still within 3s of camera 2's shed event
        trigger.onEvent(2, 'ready'); // must DISPATCH: a shed event must not have debounced camera 2
        await flush();
        expect(check).toHaveBeenCalledTimes(2);
        expect(check).toHaveBeenLastCalledWith(2);
    });

    it('is a no-op on a falsy cameraId or a missing check callback', async () => {
        const check = vi.fn(() => Promise.resolve());
        const trigger = new MediaMtxHookTrigger({ check, now: () => 1000 });
        trigger.onEvent(0, 'ready');
        trigger.onEvent(null, 'ready');
        trigger.onEvent(undefined, 'ready');
        await flush();
        expect(check).not.toHaveBeenCalled();

        const noCheck = new MediaMtxHookTrigger({ check: null, now: () => 1000 });
        expect(() => noCheck.onEvent(5, 'ready')).not.toThrow();
    });

    it('swallows a rejected check (never rejects onEvent) and still frees the slot', async () => {
        let calls = 0;
        const check = vi.fn(() => { calls += 1; return Promise.reject(new Error('boom')); });
        const trigger = new MediaMtxHookTrigger({ check, maxInflight: 1, debounceMs: 0, now: () => Date.now() });
        trigger.onEvent(1);
        await flush();
        await flush();
        // Slot must be released even though the check rejected, so a later event still runs.
        trigger.onEvent(2);
        await flush();
        expect(calls).toBe(2);
    });
});
