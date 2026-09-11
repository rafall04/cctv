/*
Unit tests for the two Titik Speaker node-endpoint hardening fixes (audio backend audit):
  - clip download grants (audioDeviceService): a device may only download a clip it was told to fetch (IDOR).
  - talk sink cap (audioDeviceTalk): one device token can't pin unbounded /node/stream connections open.
Both are pure in-memory logic, so they run without a DB or fastify (connectionPool is mocked to no-ops).
*/

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../database/connectionPool.js', () => ({
    query: () => [],
    queryOne: () => null,
    execute: () => ({ changes: 0, lastInsertRowid: 0 }),
}));

const { grantClip, isClipGranted, COMMAND_TTL_MS } = await import('../services/audioDeviceService.js');
const { addSink, removeSink, writeToDevice, endDeviceTalk } = await import('../services/audioDeviceTalk.js');

describe('clip download grants (IDOR guard)', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('authorizes only the exact clip a device was told to fetch', () => {
        grantClip(7, 42);
        expect(isClipGranted(7, 42)).toBe(true);   // the granted clip
        expect(isClipGranted(7, 43)).toBe(false);  // a different clip the device was never handed
        expect(isClipGranted(8, 42)).toBe(false);  // another device cannot ride device 7's grant
    });

    it('refuses a clip that was never granted', () => {
        expect(isClipGranted(99, 1)).toBe(false);
    });

    it('expires a grant after the node command TTL', () => {
        vi.useFakeTimers();
        grantClip(3, 5);
        expect(isClipGranted(3, 5)).toBe(true);
        vi.advanceTimersByTime(COMMAND_TTL_MS + 1000);
        expect(isClipGranted(3, 5)).toBe(false); // stale grant is pruned, so a late replay 404s
    });

    it('ignores malformed device/clip ids', () => {
        grantClip('x', 'y');
        expect(isClipGranted('x', 'y')).toBe(false);
    });
});

describe('talk sink cap (DoS guard)', () => {
    const makeSink = () => {
        const s = { ended: false, writes: 0 };
        s.write = () => { s.writes += 1; };
        s.end = () => { s.ended = true; };
        return s;
    };

    beforeEach(() => { endDeviceTalk(1); });

    it('caps open sinks per device and evicts the oldest', () => {
        const a = makeSink(); const b = makeSink(); const c = makeSink(); const d = makeSink();
        addSink(1, a); addSink(1, b); addSink(1, c); // at the cap (3)
        addSink(1, d);                               // over cap -> evict the oldest (a)
        expect(a.ended).toBe(true);                  // oldest closed so a rogue token can't pin thousands open
        // Only the surviving sinks (b, c, d) still receive frames.
        const n = writeToDevice(1, Buffer.from([0]));
        expect(n).toBe(3);
        expect(a.writes).toBe(0);
    });
});
