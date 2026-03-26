/**
 * Viewer Routes
 * API endpoints for viewer session tracking
 */

import {
    startViewerSession,
    viewerHeartbeat,
    stopViewerSession,
    reportViewerRuntimeSignal,
    getActiveViewers,
    getViewerStats,
    getViewerHistory
} from '../controllers/viewerController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function viewerRoutes(fastify, options) {
    // Public endpoints (called by frontend when viewing streams)
    
    // Start viewing session
    fastify.post('/start', {
        schema: {
            body: {
                type: 'object',
                required: ['cameraId'],
                properties: {
                    cameraId: {
                        anyOf: [
                            { type: 'integer' },
                            { type: 'string', minLength: 1 }
                        ]
                    }
                }
            }
        },
        handler: startViewerSession
    });

    // Heartbeat to keep session alive
    fastify.post('/heartbeat', {
        schema: {
            body: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string' }
                }
            }
        },
        handler: viewerHeartbeat
    });

    // Stop viewing session
    fastify.post('/stop', {
        schema: {
            body: {
                type: 'object',
                required: ['sessionId'],
                properties: {
                    sessionId: { type: 'string' }
                }
            }
        },
        handler: stopViewerSession
    });

    fastify.post('/runtime-signal', {
        schema: {
            body: {
                type: 'object',
                required: ['cameraId'],
                properties: {
                    cameraId: {
                        anyOf: [
                            { type: 'integer' },
                            { type: 'string', minLength: 1 }
                        ]
                    },
                    targetUrl: { type: 'string' },
                    signalType: { type: 'string' },
                    success: { type: 'boolean' }
                }
            }
        },
        handler: reportViewerRuntimeSignal
    });

    // Admin-only endpoints
    
    // Get active viewers
    fastify.get('/active', {
        onRequest: [authMiddleware],
        handler: getActiveViewers
    });

    // Get viewer statistics
    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getViewerStats
    });

    // Get viewer history
    fastify.get('/history', {
        onRequest: [authMiddleware],
        handler: getViewerHistory
    });
}
