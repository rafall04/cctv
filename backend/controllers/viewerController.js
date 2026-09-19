/**
 * Viewer Controller
 * Handles viewer session tracking API endpoints
 */

import viewerSessionService from '../services/viewerSessionService.js';
import cameraService from '../services/cameraService.js';
import cameraHealthService from '../services/cameraHealthService.js';
import { getStreamCapabilities } from '../utils/cameraDelivery.js';
import { checkRateLimit } from '../middleware/rateLimiter.js';

// Per-camera ceiling for client runtime signals (see reportViewerRuntimeSignal). Deliberately well
// above the real cadence (a viewer emits a handful per minute) so only floods are cut.
const RUNTIME_SIGNAL_MAX_PER_MIN = 240;

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
 * Body: { sessionId: string, cancelled?: boolean }
 * `cancelled` means the viewer never watched (start/teardown race) — the session is erased.
 */
export async function stopViewerSession(request, reply) {
    try {
        const { sessionId, cancelled } = request.body;

        if (!sessionId) {
            return reply.code(400).send({
                success: false,
                message: 'Session ID is required'
            });
        }

        const isCancelled = cancelled === true;
        const success = viewerSessionService.endSession(sessionId, isCancelled ? { cancelled: true } : {});

        if (!success) {
            return reply.send({ success, message: 'Session not found or already ended' });
        }

        return reply.send({
            success,
            message: isCancelled ? 'Session cancelled' : 'Session ended'
        });
    } catch (error) {
        console.error('Stop viewer session error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Failed to end viewer session'
        });
    }
}

export async function reportViewerRuntimeSignal(request, reply) {
    try {
        const rawCameraId = request.body?.cameraId;
        const cameraId = Number.parseInt(rawCameraId, 10);

        if (!Number.isInteger(cameraId) || cameraId <= 0) {
            return reply.code(400).send({
                success: false,
                message: 'Camera ID is required'
            });
        }

        // Camera must exist — recordRuntimeSignal() would otherwise create in-memory state for an
        // arbitrary id, letting a script pollute health state with non-cameras.
        const camera = cameraService.getCameraById(cameraId);
        if (!camera) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found'
            });
        }

        // Per-camera flood bound. The generic limiter caps 100/min per client IP, but one camera can
        // be targeted from many IPs; the real cadence is a few signals per viewer per minute.
        const gate = checkRateLimit(`runtime-signal:${cameraId}`, RUNTIME_SIGNAL_MAX_PER_MIN, 60000);
        if (!gate.allowed) {
            reply.header('Retry-After', gate.retryAfter);
            return reply.code(429).send({
                success: false,
                message: 'Terlalu banyak sinyal untuk kamera ini. Coba lagi sebentar lagi.',
                retryAfter: gate.retryAfter
            });
        }

        /*
         * SECURITY — presence gate.
         *
         * A runtime signal is an unauthenticated CLIENT CLAIM (this endpoint is public so anonymous
         * viewers can report playback health). Applying it mutates camera state: it can mark a camera
         * online (`is_online=1` + effectiveOnline), set providerDomain/lastRuntimeTarget from the
         * caller's targetUrl, force tier 'hot', and trigger recordingControl.reconcile() — i.e. an
         * anonymous script could falsify health and start on-demand recordings for every camera.
         *
         * So the claim is only honoured while the camera actually has a live viewer session (created
         * by POST /api/viewer/start, kept fresh by 5s heartbeats). A real viewer always has one; a
         * bare forge does not. Requests without presence are acknowledged (200) but ignored so the
         * player never sees an error, and nothing downstream is touched.
         */
        if (!viewerSessionService.hasActiveSessionForCamera(cameraId)) {
            return reply.send({
                success: true,
                ignored: true,
                message: 'Runtime signal ignored - no active viewer session'
            });
        }

        const success = request.body?.success !== false;
        const signalType = typeof request.body?.signalType === 'string' && request.body.signalType.trim()
            ? request.body.signalType.trim()
            : 'runtime_success';
        const targetUrl = typeof request.body?.targetUrl === 'string' && request.body.targetUrl.trim()
            ? request.body.targetUrl.trim()
            : null;

        cameraHealthService.recordRuntimeSignal(cameraId, {
            targetUrl,
            signalType,
            success,
            timestamp: Date.now(),
        });

        return reply.send({
            success: true,
            message: 'Runtime signal recorded'
        });
    } catch (error) {
        // cameraService.getCameraById throws a 404-carrying error for unknown ids; surface 4xx as-is
        // instead of masking every failure as a 500.
        const code = Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode < 500
            ? error.statusCode
            : 500;
        if (code === 500) {
            console.error('Report viewer runtime signal error:', error);
        }
        return reply.code(code).send({
            success: false,
            message: code === 500 ? 'Failed to record runtime signal' : (error.message || 'Failed to record runtime signal')
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
