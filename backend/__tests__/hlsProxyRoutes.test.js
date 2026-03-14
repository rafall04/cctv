import { describe, expect, it, vi } from 'vitest';
import {
    FixedWindowLimiter,
    HlsSessionStore,
    getViewerIdentity,
    isTrustedProxy,
} from '../routes/hlsProxyRoutes.js';

function createRequest(overrides = {}) {
    return {
        ip: '10.0.0.10',
        headers: {},
        socket: { remoteAddress: '10.0.0.10' },
        raw: { socket: { remoteAddress: '10.0.0.10' } },
        ...overrides,
    };
}

describe('hlsProxyRoutes trust model', () => {
    it('accepts forwarded IP only from trusted proxies', () => {
        const request = createRequest({
            ip: '10.1.2.3',
            headers: { 'x-forwarded-for': '203.0.113.10' },
        });

        const result = getViewerIdentity(request, ['10.0.0.0/8']);

        expect(result).toBe('203.0.113.10');
    });

    it('ignores spoofed XFF from untrusted sources', () => {
        const request = createRequest({
            ip: '198.51.100.25',
            headers: { 'x-forwarded-for': '203.0.113.10' },
        });

        const result = getViewerIdentity(request, ['10.0.0.0/8']);

        expect(result).toBe('198.51.100.25');
    });

    it('matches exact localhost IPv6 CIDR', () => {
        expect(isTrustedProxy('::1', ['::1/128'])).toBe(true);
        expect(isTrustedProxy('::2', ['::1/128'])).toBe(false);
    });
});

describe('FixedWindowLimiter', () => {
    it('blocks after limit inside one window', () => {
        const limiter = new FixedWindowLimiter(2, 1000);

        expect(limiter.isAllowed('viewer', 0)).toBe(true);
        expect(limiter.isAllowed('viewer', 1)).toBe(true);
        expect(limiter.isAllowed('viewer', 2)).toBe(false);
    });
});

describe('HlsSessionStore', () => {
    it('reuses existing playlist session instead of creating duplicates', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 25000 });
        const startSession = vi.fn(async () => 'session-1');
        const heartbeat = vi.fn(async () => true);

        const first = await store.getOrCreateSession({
            identity: 'viewer-1',
            cameraId: 7,
            request: {},
            startSession,
            heartbeat,
        });

        const second = await store.getOrCreateSession({
            identity: 'viewer-1',
            cameraId: 7,
            request: {},
            startSession,
            heartbeat,
        });

        expect(first).toBe('session-1');
        expect(second).toBe('session-1');
        expect(startSession).toHaveBeenCalledTimes(1);
    });

    it('keeps segment access from creating new sessions', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 25000 });
        const heartbeat = vi.fn(async () => true);

        store.setSessionEntry('viewer-2', 8, 'session-8', 1000);
        const sessionId = await store.recordSegmentAccess('viewer-2', 8, heartbeat);

        expect(sessionId).toBe('session-8');
        expect(heartbeat).toHaveBeenCalledTimes(1);
    });

    it('removes dead session on heartbeat failure', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 25000 });
        const heartbeat = vi.fn(async () => false);

        store.setSessionEntry('viewer-3', 9, 'session-9', 1000);
        const sessionId = await store.recordSegmentAccess('viewer-3', 9, heartbeat);

        expect(sessionId).toBe(null);
        expect(store.getSessionEntry('viewer-3', 9)).toBe(null);
    });

    it('cleans expired entries and closes backend sessions', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 1000, cameraIdCacheTtlMs: 1000 });
        const endSession = vi.fn(async () => true);

        store.setSessionEntry('viewer-4', 10, 'session-10', 0);
        store.setCameraId('abc-stream', 10, 0);

        const cleaned = await store.cleanupExpired(endSession, 1500);

        expect(cleaned).toBe(1);
        expect(endSession).toHaveBeenCalledWith('session-10');
        expect(store.getSessionEntry('viewer-4', 10)).toBe(null);
        expect(store.getCameraId('abc-stream')).toBe(null);
    });

    it('evicts stale entries when camera cap is exceeded', () => {
        const store = new HlsSessionStore({
            maxSessionCacheEntries: 10,
            maxSessionCacheEntriesPerCamera: 2,
        });

        store.setSessionEntry('viewer-a', 11, 'session-a', 10);
        store.setSessionEntry('viewer-b', 11, 'session-b', 20);
        store.setSessionEntry('viewer-c', 11, 'session-c', 30);

        expect(store.getSessionEntry('viewer-a', 11)).toBe(null);
        expect(store.getSessionEntry('viewer-b', 11)?.sessionId).toBe('session-b');
        expect(store.getSessionEntry('viewer-c', 11)?.sessionId).toBe('session-c');
    });

    it('coalesces concurrent playlist creation into one inflight session', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 25000 });
        let resolveSession;
        const startSession = vi.fn(() => new Promise((resolve) => {
            resolveSession = resolve;
        }));
        const heartbeat = vi.fn(async () => false);

        const firstPromise = store.getOrCreateSession({
            identity: 'viewer-race',
            cameraId: 12,
            request: {},
            startSession,
            heartbeat,
        });
        const secondPromise = store.getOrCreateSession({
            identity: 'viewer-race',
            cameraId: 12,
            request: {},
            startSession,
            heartbeat,
        });

        resolveSession('session-race');

        await expect(firstPromise).resolves.toBe('session-race');
        await expect(secondPromise).resolves.toBe('session-race');
        expect(startSession).toHaveBeenCalledTimes(1);
    });
    it('blocks new session creation after control limit is reached', async () => {
        const store = new HlsSessionStore({
            maxSessionCreatesPerWindow: 1,
            controlWindowMs: 60000,
        });
        const startSession = vi.fn(async (cameraId) => `session-${cameraId}`);
        const heartbeat = vi.fn(async () => false);

        const first = await store.getOrCreateSession({
            identity: 'viewer-limit',
            cameraId: 20,
            request: {},
            startSession,
            heartbeat,
        });

        const second = await store.getOrCreateSession({
            identity: 'viewer-limit',
            cameraId: 21,
            request: {},
            startSession,
            heartbeat,
        });

        expect(first).toBe('session-20');
        expect(second).toBe(null);
        expect(startSession).toHaveBeenCalledTimes(1);
    });

    it('applies lookup miss limiter per identity and stream path', () => {
        const store = new HlsSessionStore({
            maxCameraLookupMissesPerWindow: 1,
            controlWindowMs: 60000,
        });

        expect(store.isLookupMissAllowed('viewer-miss', 'stream-x', 0)).toBe(true);
        expect(store.isLookupMissAllowed('viewer-miss', 'stream-x', 1)).toBe(false);
        expect(store.isLookupMissAllowed('viewer-miss', 'stream-y', 1)).toBe(true);
    });


});
