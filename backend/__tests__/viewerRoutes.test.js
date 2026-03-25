import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startSessionMock = vi.fn();
const getCameraByIdMock = vi.fn();

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

describe('viewerRoutes', () => {
    beforeEach(() => {
        startSessionMock.mockReset();
        getCameraByIdMock.mockReset();
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
});
