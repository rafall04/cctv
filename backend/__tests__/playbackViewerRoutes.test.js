/**
 * Purpose: Verify playback viewer routes map service behavior to HTTP responses.
 * Caller: Vitest backend suite.
 * Deps: Fastify playback viewer routes, playback viewer session service, camera service, auth middleware.
 * MainFuncs: playbackViewerRoutes test cases for start, validation, and analytics behavior.
 * SideEffects: Exercises route handlers against mocked services.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startSessionMock = vi.fn();
const heartbeatMock = vi.fn();
const endSessionMock = vi.fn();
const getActiveSessionsMock = vi.fn();
const getStatsMock = vi.fn();
const getSessionHistoryMock = vi.fn();
const getAnalyticsMock = vi.fn();
const getCameraByIdMock = vi.fn();

vi.mock('../services/playbackViewerSessionService.js', () => ({
    default: {
        startSession: startSessionMock,
        heartbeat: heartbeatMock,
        endSession: endSessionMock,
        getActiveSessions: getActiveSessionsMock,
        getStats: getStatsMock,
        getSessionHistory: getSessionHistoryMock,
        getAnalytics: getAnalyticsMock,
    },
}));

vi.mock('../services/cameraService.js', () => ({
    default: {
        getCameraById: getCameraByIdMock,
    },
}));

vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: async (request) => {
        request.user = { id: 1, username: 'admin' };
    },
    optionalAuthMiddleware: async (request) => {
        if (request.headers.authorization) {
            request.user = { id: 1, username: 'admin' };
        }
    },
}));

describe('playbackViewerRoutes', () => {
    beforeEach(() => {
        startSessionMock.mockReset();
        heartbeatMock.mockReset();
        endSessionMock.mockReset();
        getActiveSessionsMock.mockReset();
        getStatsMock.mockReset();
        getSessionHistoryMock.mockReset();
        getAnalyticsMock.mockReset();
        getCameraByIdMock.mockReset();

        startSessionMock.mockReturnValue('playback-session-123');
        heartbeatMock.mockReturnValue(true);
        endSessionMock.mockReturnValue(true);
        getActiveSessionsMock.mockReturnValue([]);
        getStatsMock.mockReturnValue({ totalActiveViewers: 0 });
        getSessionHistoryMock.mockReturnValue([]);
        getAnalyticsMock.mockReturnValue({ overview: { totalSessions: 0 } });
    });

    it('starts playback viewer sessions for public preview requests', async () => {
        getCameraByIdMock.mockReturnValue({ id: 7, enabled: 1, name: 'Lobby' });
        const { default: playbackViewerRoutes } = await import('../routes/playbackViewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(playbackViewerRoutes, { prefix: '/api/playback-viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/playback-viewer/start',
            payload: {
                cameraId: 7,
                segmentFilename: 'seg-1.mp4',
                segmentStartedAt: '2026-03-29T10:00:00.000Z',
                accessMode: 'public_preview',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(startSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            cameraName: 'Lobby',
            segmentFilename: 'seg-1.mp4',
            accessMode: 'public_preview',
            adminUserId: null,
        }), expect.any(Object));
        await fastify.close();
    });

    it('starts playback viewer sessions for admin playback requests with actor metadata', async () => {
        getCameraByIdMock.mockReturnValue({ id: 8, enabled: 1, name: 'Gate' });
        const { default: playbackViewerRoutes } = await import('../routes/playbackViewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(playbackViewerRoutes, { prefix: '/api/playback-viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/playback-viewer/start',
            headers: {
                authorization: 'Bearer fake-token',
            },
            payload: {
                cameraId: 8,
                segmentFilename: 'seg-2.mp4',
                accessMode: 'admin_full',
            },
        });

        expect(response.statusCode).toBe(200);
        expect(startSessionMock).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 8,
            accessMode: 'admin_full',
            adminUserId: 1,
            adminUsername: 'admin',
        }), expect.any(Object));
        await fastify.close();
    });

    it('rejects disabled cameras before creating playback sessions', async () => {
        getCameraByIdMock.mockReturnValue({ id: 9, enabled: 0, name: 'Closed Cam' });
        const { default: playbackViewerRoutes } = await import('../routes/playbackViewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(playbackViewerRoutes, { prefix: '/api/playback-viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/playback-viewer/start',
            payload: {
                cameraId: 9,
                segmentFilename: 'seg-9.mp4',
                accessMode: 'public_preview',
            },
        });

        expect(response.statusCode).toBe(400);
        expect(response.json().message).toBe('Camera is disabled');
        expect(startSessionMock).not.toHaveBeenCalled();
        await fastify.close();
    });

    it('returns 403 when ASN policy denies playback access', async () => {
        getCameraByIdMock.mockReturnValue({ id: 11, enabled: 1, name: 'Garage' });
        startSessionMock.mockImplementationOnce(() => {
            const error = new Error('ASN policy denied');
            error.statusCode = 403;
            throw error;
        });
        const { default: playbackViewerRoutes } = await import('../routes/playbackViewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(playbackViewerRoutes, { prefix: '/api/playback-viewer' });

        const response = await fastify.inject({
            method: 'POST',
            url: '/api/playback-viewer/start',
            payload: {
                cameraId: 11,
                segmentFilename: 'seg-11.mp4',
                accessMode: 'public_preview',
            },
        });

        expect(response.statusCode).toBe(403);
        expect(response.json().message).toBe('ASN policy denied');
        await fastify.close();
    });

    it('serves playback analytics from the dedicated playback session service', async () => {
        getAnalyticsMock.mockReturnValue({
            overview: { totalSessions: 12 },
            accessBreakdown: [{ playback_access_mode: 'public_preview', count: 7 }],
        });
        const { default: playbackViewerRoutes } = await import('../routes/playbackViewerRoutes.js');
        const fastify = Fastify();
        await fastify.register(playbackViewerRoutes, { prefix: '/api/playback-viewer' });

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/playback-viewer/analytics?period=7days&cameraId=3&accessMode=admin_full',
        });

        expect(response.statusCode).toBe(200);
        expect(getAnalyticsMock).toHaveBeenCalledWith('7days', { cameraId: '3', accessMode: 'admin_full' });
        expect(response.json()).toMatchObject({
            success: true,
            data: {
                overview: { totalSessions: 12 },
            },
        });
        await fastify.close();
    });
});
