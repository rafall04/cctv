/**
 * Purpose: Verify live viewer routes map validation and service errors to HTTP responses.
 * Caller: Vitest backend suite.
 * Deps: Fastify viewer routes, viewer session service, camera service, camera health service.
 * MainFuncs: viewerRoutes test cases for start, validation, and runtime-signal behavior.
 * SideEffects: Exercises route handlers against mocked services.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startSessionMock = vi.fn();
const getCameraByIdMock = vi.fn();
const recordRuntimeSignalMock = vi.fn();

vi.mock('../services/viewerSessionService.js', () => ({
    default: {
        startSession: startSessionMock,
        heartbeat: vi.fn(),
        endSession: vi.fn(),
        getActiveSessions: vi.fn(() => []),
        getViewerStats: vi.fn(() => ({})),
        getSessionHistory: vi.fn(() => []),
    },
}));

vi.mock('../services/cameraService.js', () => ({
    default: {
        getCameraById: getCameraByIdMock,
    },
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        recordRuntimeSignal: recordRuntimeSignalMock,
    },
}));

describe('viewerRoutes', () => {
    beforeEach(() => {
        startSessionMock.mockReset();
        getCameraByIdMock.mockReset();
        recordRuntimeSignalMock.mockReset();
        startSessionMock.mockReturnValue('session-123');
    });

    it('starts viewer sessions for internal popup cameras', async () => {
        getCameraByIdMock.mockReturnValue({ id: 1, enabled: 1, delivery_type: 'internal_hls' });
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: 1 },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, data: { sessionId: 'session-123' } });
        await fastify.close();
    });

    it('starts viewer sessions for external hls cameras', async () => {
        getCameraByIdMock.mockReturnValue({ id: 2, enabled: 1, delivery_type: 'external_hls' });
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: '2' },
        });

        expect(response.statusCode).toBe(200);
        await fastify.close();
    });

    it('starts viewer sessions for external mjpeg cameras', async () => {
        getCameraByIdMock.mockReturnValue({ id: 3, enabled: 1, delivery_type: 'external_mjpeg' });
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: 3 },
        });

        expect(response.statusCode).toBe(200);
        await fastify.close();
    });

    it('rejects disabled cameras', async () => {
        getCameraByIdMock.mockReturnValue({ id: 4, enabled: 0, delivery_type: 'internal_hls' });
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: 4 },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toBe('Camera is disabled');
        await fastify.close();
    });

    it('rejects invalid camera ids before lookup', async () => {
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: '' },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toContain('cameraId');
        expect(getCameraByIdMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('returns 403 when ASN policy denies live access', async () => {
        getCameraByIdMock.mockReturnValue({ id: 10, enabled: 1, delivery_type: 'internal_hls' });
        startSessionMock.mockImplementationOnce(() => {
            const error = new Error('ASN policy denied');
            error.statusCode = 403;
            throw error;
        });
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/start',
            payload: { cameraId: 10 },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().message).toBe('ASN policy denied');
        await fastify.close();
    });

    it('records runtime success signals for passive health evidence', async () => {
        const { default: viewerRoutes } = await import('../routes/viewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(viewerRoutes, { prefix: '/api/viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/viewer/runtime-signal',
            payload: {
                cameraId: 393,
                targetUrl: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
                signalType: 'external_mjpeg_image_load',
                success: true,
            },
        });

        expect(response.statusCode).toBe(200);
        expect(recordRuntimeSignalMock).toHaveBeenCalledWith(393, expect.objectContaining({
            targetUrl: expect.stringContaining('jombangkab.go.id'),
            signalType: 'external_mjpeg_image_load',
            success: true,
        }));
        await fastify.close();
    });
});
