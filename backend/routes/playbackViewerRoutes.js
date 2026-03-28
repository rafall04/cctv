import {
    startPlaybackViewerSession,
    playbackViewerHeartbeat,
    stopPlaybackViewerSession,
    getActivePlaybackViewers,
    getPlaybackViewerStats,
    getPlaybackViewerHistory,
    getPlaybackViewerAnalytics,
} from '../controllers/playbackViewerController.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';

export default async function playbackViewerRoutes(fastify) {
    fastify.post('/start', {
        onRequest: [optionalAuthMiddleware],
        schema: {
            body: {
                type: 'object',
                required: ['cameraId', 'segmentFilename', 'accessMode'],
                properties: {
                    cameraId: {
                        anyOf: [
                            { type: 'integer' },
                            { type: 'string', minLength: 1 },
                        ],
                    },
                    segmentFilename: { type: 'string', minLength: 1 },
                    segmentStartedAt: { type: 'string' },
                    accessMode: { type: 'string', enum: ['public_preview', 'admin_full'] },
                },
            },
        },
        handler: startPlaybackViewerSession,
    });

    fastify.post('/heartbeat', {
        onRequest: [optionalAuthMiddleware],
        schema: {
            body: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string', minLength: 1 },
                },
            },
        },
        handler: playbackViewerHeartbeat,
    });

    fastify.post('/stop', {
        onRequest: [optionalAuthMiddleware],
        schema: {
            body: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string', minLength: 1 },
                },
            },
        },
        handler: stopPlaybackViewerSession,
    });

    fastify.get('/active', {
        onRequest: [authMiddleware],
        handler: getActivePlaybackViewers,
    });

    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getPlaybackViewerStats,
    });

    fastify.get('/history', {
        onRequest: [authMiddleware],
        handler: getPlaybackViewerHistory,
    });

    fastify.get('/analytics', {
        onRequest: [authMiddleware],
        handler: getPlaybackViewerAnalytics,
    });
}
