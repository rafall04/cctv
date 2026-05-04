/**
 * Purpose: Verify HLS proxy helpers, session cache behavior, and proxied HLS viewer-session closure precision.
 * Caller: Backend Vitest suite for routes/hlsProxyRoutes.js.
 * Deps: vitest, events, hlsProxyRoutes exports.
 * MainFuncs: HlsSessionStore tests, proxy helper tests.
 * SideEffects: None; uses mocks and in-memory stores only.
 */

import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import {
    attachAbortCleanup,
    cleanupUpstreamResponse,
    fetchBufferedBinaryUpstream,
    fetchBinaryUpstream,
    fetchTextUpstream,
    FixedWindowLimiter,
    HlsSessionStore,
    getViewerIdentity,
    isExternalProxyUrlCompatible,
    isExternalProxyTargetAllowed,
    isTrustedProxy,
    resolveExternalCameraProxyConfig,
} from '../routes/hlsProxyRoutes.js';

function createRequest(overrides = {}) {
    return {
        ip: '10.0.0.10',
        headers: {},
        socket: { remoteAddress: '10.0.0.10' },
        raw: new EventEmitter(),
        ...overrides,
    };
}

function createStream() {
    const stream = new EventEmitter();
    stream.destroyed = false;
    stream.pipe = vi.fn();
    stream.destroy = vi.fn(() => {
        stream.destroyed = true;
    });
    return stream;
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

    it('evicts the stalest key when key cap is exceeded', () => {
        const limiter = new FixedWindowLimiter(1, 1000, 2);

        expect(limiter.isAllowed('viewer-a', 0)).toBe(true);
        expect(limiter.isAllowed('viewer-b', 1)).toBe(true);
        expect(limiter.isAllowed('viewer-c', 2)).toBe(true);
        expect(limiter.size()).toBe(2);
        expect(limiter.entries.has('viewer-a')).toBe(false);
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
        expect(endSession).toHaveBeenCalledWith('session-10', expect.objectContaining({
            endedAtMs: expect.any(Number),
        }));
        expect(store.getSessionEntry('viewer-4', 10)).toBe(null);
        expect(store.getCameraId('abc-stream')).toBe(null);
    });

    it('passes the last touched time when closing an expired HLS session', async () => {
        const store = new HlsSessionStore({ sessionCacheTtlMs: 1000, cameraIdCacheTtlMs: 1000 });
        const endSession = vi.fn(async () => true);

        store.setSessionEntry('viewer-precision', 30, 'session-precision', 1000);
        store.touchSession('viewer-precision', 30, 'segment', 2200);

        await store.cleanupExpired(endSession, 4000);

        expect(endSession).toHaveBeenCalledWith('session-precision', expect.objectContaining({
            endedAtMs: 2200,
        }));
    });

    it('drains pending session closes in batches', async () => {
        const store = new HlsSessionStore({ sessionCloseBatchSize: 2 });
        const endSession = vi.fn(async () => true);

        store.queueSessionClose('session-1');
        store.queueSessionClose('session-2');
        store.queueSessionClose('session-3');

        const firstBatch = await store.drainPendingSessionCloses(endSession);
        const secondBatch = await store.drainPendingSessionCloses(endSession);

        expect(firstBatch).toBe(2);
        expect(secondBatch).toBe(1);
        expect(endSession).toHaveBeenCalledTimes(3);
    });

    it('evicts stale entries when camera cap is exceeded and queues session close', async () => {
        const store = new HlsSessionStore({
            maxSessionCacheEntries: 10,
            maxSessionCacheEntriesPerCamera: 2,
        });
        const endSession = vi.fn(async () => true);

        store.setSessionEntry('viewer-a', 11, 'session-a', 10);
        store.setSessionEntry('viewer-b', 11, 'session-b', 20);
        store.setSessionEntry('viewer-c', 11, 'session-c', 30);

        expect(store.getSessionEntry('viewer-a', 11)).toBe(null);
        expect(store.getSessionEntry('viewer-b', 11)?.sessionId).toBe('session-b');
        expect(store.getSessionEntry('viewer-c', 11)?.sessionId).toBe('session-c');
        expect(store.pendingSessionCloses.has('session-a')).toBe(true);

        await store.drainPendingSessionCloses(endSession);
        expect(endSession).toHaveBeenCalledWith('session-a', expect.objectContaining({
            endedAtMs: 10,
        }));
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

describe('upstream stream cleanup', () => {
    it('aborts controller and destroys stream safely', () => {
        const controller = new AbortController();
        const stream = createStream();

        cleanupUpstreamResponse({
            controller,
            response: { data: stream },
        });
        cleanupUpstreamResponse({
            controller,
            response: { data: stream },
        });

        expect(controller.signal.aborted).toBe(true);
        expect(stream.destroy).toHaveBeenCalledTimes(1);
    });

    it('destroys upstream stream on request abort', () => {
        const request = createRequest();
        const reply = { raw: new EventEmitter() };
        const controller = new AbortController();
        const stream = createStream();

        const lifecycle = attachAbortCleanup({
            request,
            reply,
            controller,
            upstreamStream: stream,
        });

        lifecycle.attach();
        request.raw.emit('aborted');
        lifecycle.cleanup();

        expect(controller.signal.aborted).toBe(true);
        expect(stream.destroy).toHaveBeenCalledTimes(1);
        expect(request.raw.listenerCount('aborted')).toBe(0);
        expect(reply.raw.listenerCount('error')).toBe(0);
    });

    it('does not abort a stream that ends normally', () => {
        const request = createRequest();
        const reply = { raw: new EventEmitter() };
        const controller = new AbortController();
        const stream = createStream();

        attachAbortCleanup({
            request,
            reply,
            controller,
            upstreamStream: stream,
        }).attach();

        stream.emit('end');
        stream.emit('close');

        expect(controller.signal.aborted).toBe(false);
        expect(stream.destroy).toHaveBeenCalledTimes(0);
        expect(request.raw.listenerCount('aborted')).toBe(0);
    });

    it('aborts upstream on reply close before stream end', () => {
        const request = createRequest();
        const reply = { raw: new EventEmitter() };
        const controller = new AbortController();
        const stream = createStream();

        attachAbortCleanup({
            request,
            reply,
            controller,
            upstreamStream: stream,
        }).attach();

        reply.raw.emit('close');

        expect(controller.signal.aborted).toBe(true);
        expect(stream.destroy).toHaveBeenCalledTimes(1);
    });

    it('does not abort upstream on reply close after finish', () => {
        const request = createRequest();
        const reply = { raw: new EventEmitter() };
        const controller = new AbortController();
        const stream = createStream();

        attachAbortCleanup({
            request,
            reply,
            controller,
            upstreamStream: stream,
        }).attach();

        reply.raw.emit('finish');
        reply.raw.emit('close');

        expect(controller.signal.aborted).toBe(false);
        expect(stream.destroy).toHaveBeenCalledTimes(0);
    });

    it('cleans up failed binary retry attempts before retrying', async () => {
        const firstStream = createStream();
        const secondStream = createStream();
        const httpClient = {
            get: vi.fn()
                .mockResolvedValueOnce({ status: 404, data: firstStream })
                .mockResolvedValueOnce({ status: 200, data: secondStream }),
        };

        const result = await fetchBinaryUpstream({
            httpClient,
            targetUrl: 'http://localhost/test_init.mp4',
            headers: {},
            maxRetries: 2,
            retryDelayMs: 0,
            sleep: async () => {},
        });

        expect(firstStream.destroy).toHaveBeenCalledTimes(1);
        expect(result.response.status).toBe(200);
        expect(result.response.data).toBe(secondStream);
    });

    it('returns final non-200 binary response after cleaning up its stream', async () => {
        const responseStream = createStream();
        const httpClient = {
            get: vi.fn().mockResolvedValueOnce({ status: 404, data: responseStream }),
        };

        const result = await fetchBinaryUpstream({
            httpClient,
            targetUrl: 'http://localhost/segment.ts',
            headers: {},
            maxRetries: 1,
            retryDelayMs: 0,
            sleep: async () => {},
        });

        cleanupUpstreamResponse({ controller: result.controller, response: result.response });

        expect(result.response.status).toBe(404);
        expect(responseStream.destroy).toHaveBeenCalledTimes(1);
    });

    it('reads text upstream without changing response type behavior', async () => {
        const httpClient = {
            get: vi.fn().mockResolvedValueOnce({ status: 200, data: '#EXTM3U' }),
        };

        const response = await fetchTextUpstream({
            httpClient,
            targetUrl: 'http://localhost/index.m3u8',
            headers: { 'User-Agent': 'test' },
            maxContentLength: 100,
            maxBodyLength: 100,
        });

        expect(response.status).toBe(200);
        expect(response.data).toBe('#EXTM3U');
        expect(httpClient.get).toHaveBeenCalledWith('http://localhost/index.m3u8', {
            headers: { 'User-Agent': 'test' },
            responseType: 'text',
            maxContentLength: 100,
            maxBodyLength: 100,
        });
    });
});

describe('buffered external binary fetch', () => {
    it('returns a full buffer for successful segment fetches', async () => {
        const httpClient = {
            get: vi.fn(async () => ({
                status: 200,
                data: Uint8Array.from([1, 2, 3, 4]).buffer,
            })),
        };

        const result = await fetchBufferedBinaryUpstream({
            httpClient,
            targetUrl: 'https://example.com/seg.ts',
            headers: {},
        });

        expect(result.status).toBe(200);
        expect(Buffer.isBuffer(result.data)).toBe(true);
        expect([...result.data]).toEqual([1, 2, 3, 4]);
    });

    it('retries once before failing buffered fetches', async () => {
        const httpClient = {
            get: vi.fn()
                .mockRejectedValueOnce(new Error('socket hang up'))
                .mockResolvedValueOnce({
                    status: 200,
                    data: Uint8Array.from([9, 8]).buffer,
                }),
        };

        const result = await fetchBufferedBinaryUpstream({
            httpClient,
            targetUrl: 'https://example.com/seg.ts',
            headers: {},
            maxRetries: 2,
            retryDelayMs: 0,
            sleep: async () => {},
        });

        expect(httpClient.get).toHaveBeenCalledTimes(2);
        expect([...result.data]).toEqual([9, 8]);
    });
});

describe('external proxy validation', () => {
    it('rejects localhost and private targets by default', () => {
        expect(isExternalProxyTargetAllowed('http://127.0.0.1/test.m3u8')).toBe(false);
        expect(isExternalProxyTargetAllowed('http://192.168.1.20/test.m3u8')).toBe(false);
        expect(isExternalProxyTargetAllowed('http://localhost/test.m3u8')).toBe(false);
    });

    it('accepts public targets and explicit allowlist entries', () => {
        expect(isExternalProxyTargetAllowed('https://example.com/test.m3u8')).toBe(true);
        expect(isExternalProxyTargetAllowed('https://stream.public.test/live.m3u8', {
            allowedHosts: ['stream.public.test'],
        })).toBe(true);
        expect(isExternalProxyTargetAllowed('https://other.test/live.m3u8', {
            allowedHosts: ['stream.public.test'],
        })).toBe(false);
    });

    it('allows private targets only when explicitly configured', () => {
        expect(isExternalProxyTargetAllowed('http://10.1.2.3/test.m3u8', {
            allowPrivateHosts: true,
        })).toBe(true);
    });

    it('accepts compatible external URLs under the configured camera base path', () => {
        expect(isExternalProxyUrlCompatible(
            'https://stream.example.com/live/cam/index.m3u8',
            'https://stream.example.com/live/cam/segment1.ts'
        )).toBe(true);
    });

    it('rejects external URLs outside the configured camera origin/base path', () => {
        expect(isExternalProxyUrlCompatible(
            'https://stream.example.com/live/cam/index.m3u8',
            'https://stream.example.com/other/path/segment1.ts'
        )).toBe(false);
        expect(isExternalProxyUrlCompatible(
            'https://stream.example.com/live/cam/index.m3u8',
            'https://other.example.com/live/cam/segment1.ts'
        )).toBe(false);
    });

    it('resolves strict and insecure camera proxy config only for matching external cameras', () => {
        expect(resolveExternalCameraProxyConfig({
            id: 44,
            stream_source: 'external',
            external_hls_url: 'https://stream.example.com/live/cam/index.m3u8',
            external_use_proxy: 1,
            external_tls_mode: 'insecure',
        }, 'https://stream.example.com/live/cam/video1_init.mp4')).toEqual({
            cameraId: 44,
            externalUseProxy: true,
            externalTlsMode: 'insecure',
        });

        expect(resolveExternalCameraProxyConfig({
            id: 45,
            stream_source: 'external',
            external_hls_url: 'https://stream.example.com/live/cam/index.m3u8',
            external_use_proxy: 1,
            external_tls_mode: 'strict',
        }, 'https://evil.example.com/live/cam/video1_init.mp4')).toBe(null);
    });
});
