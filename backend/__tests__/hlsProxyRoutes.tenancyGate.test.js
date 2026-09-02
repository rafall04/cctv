/**
 * Purpose: Guard the /hls/* tenancy gate's fail-CLOSED default — a path whose camera row is
 *          unknown (deleted while MediaMTX still serves the path) must be refused, never proxied,
 *          while a live community path keeps streaming.
 * Caller: Backend Vitest suite for routes/hlsProxyRoutes.js.
 * Deps: vitest, fastify, mocked hlsProxyService/connectionPool/voucherService; REAL cameraAccessService.
 * MainFuncs: unknown-camera-row rejection tests, community pass-through test.
 * SideEffects: None; in-memory Fastify instances and mocks only.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();
const fetchTextUpstreamMock = vi.fn();
const fetchBinaryUpstreamMock = vi.fn();
const recordRuntimeSignalMock = vi.fn();

// Real cameraAccessService (the gate under test) reads through these two.
vi.mock('../database/connectionPool.js', () => ({
    queryOne: (...args) => queryOneMock(...args),
    query: vi.fn(() => []),
    execute: vi.fn(),
}));

vi.mock('../services/voucherService.js', () => ({
    default: {
        isAreaAccessGated: vi.fn(() => false),
        hasAreaAccess: vi.fn(() => false),
    },
}));

vi.mock('../services/hlsProxyService.js', () => ({
    createHlsRouteState: () => ({
        httpClient: {},
        start: vi.fn(),
        stop: vi.fn(async () => {}),
        getViewerIdentity: () => 'viewer-1',
        extractCameraId: () => null,
        getOrCreateSession: vi.fn(async () => 'session-1'),
        recordSegmentAccess: vi.fn(async () => true),
    }),
    applyHlsCorsHeaders: vi.fn(),
    handleExternalStreamProxy: vi.fn(),
    verifyStreamToken: (_request, _reply, done) => done(),
    fetchTextUpstream: (...args) => fetchTextUpstreamMock(...args),
    applyLegacyCacheHeaders: vi.fn(),
    fetchBinaryUpstream: (...args) => fetchBinaryUpstreamMock(...args),
    cleanupUpstreamResponse: vi.fn(),
    attachAbortCleanup: () => ({ attach: vi.fn() }),
    resolveHlsViewerUser: () => null,
    propagateTokenInPlaylist: (body) => body,
}));

vi.mock('../services/streamHotlinkPolicy.js', () => ({
    isTrustedStreamRequest: () => true,
}));

vi.mock('../services/voucherPass.js', () => ({
    readVoucherDeviceHash: () => null,
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: { recordRuntimeSignal: (...args) => recordRuntimeSignalMock(...args) },
}));

const STREAM_KEY = '04bd5387-9db4-4cf0-9f8d-7fb42cc76263';

function communityRow(overrides = {}) {
    return {
        id: 12,
        stream_key: STREAM_KEY,
        enabled: 1,
        owner_user_id: null,
        camera_class: 'community',
        billing_status: null,
        is_public: 1,
        area_id: null,
        ...overrides,
    };
}

async function buildServer() {
    const { default: hlsProxyRoutes } = await import('../routes/hlsProxyRoutes.js');
    const fastify = Fastify();
    await fastify.register(hlsProxyRoutes, { prefix: '/hls' });
    return fastify;
}

describe('/hls/* tenancy gate fails CLOSED on an unknown camera row', () => {
    beforeEach(async () => {
        queryOneMock.mockReset();
        fetchTextUpstreamMock.mockReset();
        fetchBinaryUpstreamMock.mockReset();
        recordRuntimeSignalMock.mockReset();
        const { invalidateCameraAccessCache } = await import('../services/cameraAccessService.js');
        invalidateCameraAccessCache();
    });

    it('refuses a playlist whose camera row no longer exists, without touching MediaMTX', async () => {
        // The leak: a private camera deleted from the DB while its MediaMTX path keeps
        // publishing. Pre-fix the gate was skipped entirely and the stream went fully public.
        queryOneMock.mockReturnValue(undefined);
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: `/hls/${STREAM_KEY}/index.m3u8`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(fetchTextUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('refuses a SEGMENT for an unknown camera row so nothing enters the edge cache', async () => {
        queryOneMock.mockReturnValue(undefined);
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: `/hls/${STREAM_KEY}/segment_7.ts`,
        });

        expect(response.statusCode).toBe(403);
        expect(response.headers['cache-control']).toBe('no-store');
        expect(fetchBinaryUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('refuses a legacy camera<id> path whose row is gone', async () => {
        queryOneMock.mockReturnValue(undefined);
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: '/hls/camera41/index.m3u8',
        });

        expect(response.statusCode).toBe(403);
        expect(fetchTextUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('refuses a path segment that never mapped to a camera at all', async () => {
        queryOneMock.mockReturnValue(undefined);
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: '/hls/not-a-camera-path/index.m3u8',
        });

        expect(response.statusCode).toBe(403);
        expect(fetchTextUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('still serves a live community playlist (the gate must not over-reject)', async () => {
        queryOneMock.mockReturnValue(communityRow());
        fetchTextUpstreamMock.mockResolvedValue({ status: 200, data: '#EXTM3U\n#EXT-X-VERSION:7\n' });
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: `/hls/${STREAM_KEY}/index.m3u8`,
        });

        expect(response.statusCode).toBe(200);
        expect(response.body).toContain('#EXTM3U');
        expect(fetchTextUpstreamMock).toHaveBeenCalledTimes(1);
        await fastify.close();
    });

    it('still refuses a known owner_private camera to an anonymous viewer', async () => {
        queryOneMock.mockReturnValue(communityRow({ camera_class: 'owner_private', owner_user_id: 5, is_public: 0 }));
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: `/hls/${STREAM_KEY}/index.m3u8`,
        });

        expect(response.statusCode).toBe(403);
        expect(fetchTextUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('refuses an encoded-slash traversal that would repoint MediaMTX past the gate (S-01)', async () => {
        // %2f..%2f survives Fastify's own normalisation as a `..` segment; the gate sees pathParts[0]
        // (a community key) but the upstream client would collapse `..` to a DIFFERENT key. Reject it.
        queryOneMock.mockReturnValue(communityRow());
        const fastify = await buildServer();

        const response = await fastify.inject({
            method: 'GET',
            url: `/hls/${STREAM_KEY}%2f..%2fother-key/index.m3u8`,
        });

        expect(response.statusCode).toBe(400);
        expect(fetchTextUpstreamMock).not.toHaveBeenCalled();
        await fastify.close();
    });
});
