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
                maxProperties: 6,
                properties: {
                    cameraId: {
                        anyOf: [
                            { type: 'integer' },
                            { type: 'string', minLength: 1, maxLength: 20 },
                        ],
                    },
                    segmentFilename: { type: 'string', minLength: 1, maxLength: 255 },
                    segmentStartedAt: { type: 'string', maxLength: 64 },
                    // token_full was missing here, so once the client started reporting it the
                    // whole request was rejected with 400 and the session vanished — the very
                    // viewers we wanted to attribute stopped being recorded at all. owner_full is
                    // the rental-owner equivalent: the client CLAIMS it, the controller VERIFIES
                    // ownership server-side before recording it.
                    accessMode: { type: 'string', enum: ['public_preview', 'token_full', 'admin_full', 'owner_full'] },
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
                maxProperties: 3,
                properties: {
                    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
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
                maxProperties: 3,
                properties: {
                    sessionId: { type: 'string', minLength: 1, maxLength: 64 },
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
