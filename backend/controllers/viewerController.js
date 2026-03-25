/**
 * Viewer Controller
 * Handles viewer session tracking API endpoints
 */

import viewerSessionService from '../services/viewerSessionService.js';
import cameraService from '../services/cameraService.js';
import { getStreamCapabilities } from '../utils/cameraDelivery.js';

/**
 * Start a new viewer session
 * POST /api/viewer/start
 * Body: { cameraId: number }
 */
export async function startViewerSession(request, reply) {
    try {
        const rawCameraId = request.body?.cameraId;
        const cameraId = Number.parseInt(rawCameraId, 10);

        if (!Number.isInteger(cameraId) || cameraId <= 0) {
            return reply.code(400).send({
                success: false,
                message: 'Camera ID is required'
            });
        }

        const camera = cameraService.getCameraById(cameraId);
        const capabilities = getStreamCapabilities(camera.delivery_type || camera);

        if (!camera.enabled) {
            return reply.code(400).send({
                success: false,
                message: 'Camera is disabled'
            });
        }

        if (!capabilities.popup) {
            return reply.code(400).send({
                success: false,
                message: 'Camera does not support popup viewing'
            });
        }

        const sessionId = viewerSessionService.startSession(cameraId, request);

        return reply.send({
            success: true,
            data: { sessionId }
        });
    } catch (error) {
        console.error('Start viewer session error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({
                success: false,
                message: error.message
            });
        }
        return reply.code(500).send({
            success: false,
            message: 'Failed to start viewer session'
        });
    }
}

/**
 * Send heartbeat to keep session alive
 * POST /api/viewer/heartbeat
 * Body: { sessionId: string }
 */
export async function viewerHeartbeat(request, reply) {
    try {
        const { sessionId } = request.body;

        if (!sessionId) {
            return reply.code(400).send({
                success: false,
                message: 'Session ID is required'
            });
        }

        const success = viewerSessionService.heartbeat(sessionId);

        return reply.send({
            success,
            message: success ? 'Heartbeat received' : 'Session not found or expired'
        });
    } catch (error) {
        console.error('Viewer heartbeat error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to process heartbeat'
        });
    }
}

/**
 * End a viewer session
 * POST /api/viewer/stop
 * Body: { sessionId: string }
 */
export async function stopViewerSession(request, reply) {
    try {
        const { sessionId } = request.body;

        if (!sessionId) {
            return reply.code(400).send({
                success: false,
                message: 'Session ID is required'
            });
        }

        const success = viewerSessionService.endSession(sessionId);

        return reply.send({
            success,
            message: success ? 'Session ended' : 'Session not found or already ended'
        });
    } catch (error) {
        console.error('Stop viewer session error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to end viewer session'
        });
    }
}

/**
 * Get active viewers (admin only)
 * GET /api/viewer/active
 */
export async function getActiveViewers(request, reply) {
    try {
        const sessions = viewerSessionService.getActiveSessions();
        const totalViewers = sessions.length;

        // Group by camera for summary
        const byCamera = {};
        sessions.forEach(session => {
            if (!byCamera[session.camera_id]) {
                byCamera[session.camera_id] = {
                    cameraId: session.camera_id,
                    cameraName: session.camera_name,
                    viewers: []
                };
            }
            byCamera[session.camera_id].viewers.push({
                sessionId: session.session_id,
                ipAddress: session.ip_address,
                deviceType: session.device_type,
                startedAt: session.started_at,
                durationSeconds: session.duration_seconds
            });
        });

        return reply.send({
            success: true,
            data: {
                totalViewers,
                cameras: Object.values(byCamera),
                sessions
            }
        });
    } catch (error) {
        console.error('Get active viewers error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get active viewers'
        });
    }
}

/**
 * Get viewer statistics (admin only)
 * GET /api/viewer/stats
 */
export async function getViewerStats(request, reply) {
    try {
        const stats = viewerSessionService.getViewerStats();

        return reply.send({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Get viewer stats error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get viewer statistics'
        });
    }
}

/**
 * Get viewer session history (admin only)
 * GET /api/viewer/history
 * Query: { limit?: number, offset?: number, cameraId?: number }
 */
export async function getViewerHistory(request, reply) {
    try {
        const { limit = 50, offset = 0, cameraId } = request.query;

        const history = viewerSessionService.getSessionHistory(
            parseInt(limit),
            parseInt(offset),
            cameraId ? parseInt(cameraId) : null
        );

        return reply.send({
            success: true,
            data: history
        });
    } catch (error) {
        console.error('Get viewer history error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to get viewer history'
        });
    }
}
