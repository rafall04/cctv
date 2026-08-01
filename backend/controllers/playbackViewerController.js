import playbackViewerSessionService from '../services/playbackViewerSessionService.js';
import playbackTokenService from '../services/playbackTokenService.js';
import cameraService from '../services/cameraService.js';

function normalizeAccessMode(value) {
    return value === 'admin_full' ? 'admin_full' : 'public_preview';
}

/**
 * Which playback token, if any, actually unlocked this camera for this request.
 *
 * Derived from the request's own playback cookie, NOT from anything the client sent. A body field
 * would let any visitor attribute their viewing to someone else's token — and this feeds the
 * analytics an operator uses to decide who is watching what.
 *
 * `touch: false` because this is bookkeeping, not an access event; the access itself is already
 * recorded where the footage is served.
 */
function resolveViewerToken(request, cameraId) {
    try {
        const token = playbackTokenService.validateRequestForCamera(request, cameraId, { touch: false });
        return token ? { id: token.id, label: token.label || null } : null;
    } catch {
        // 401/403 simply mean "no usable token on this request" — a public preview, not an error.
        return null;
    }
}

export async function startPlaybackViewerSession(request, reply) {
    try {
        const rawCameraId = request.body?.cameraId;
        const cameraId = Number.parseInt(rawCameraId, 10);
        const segmentFilename = typeof request.body?.segmentFilename === 'string'
            ? request.body.segmentFilename.trim()
            : '';
        const segmentStartedAt = typeof request.body?.segmentStartedAt === 'string'
            ? request.body.segmentStartedAt.trim()
            : null;
        const accessMode = normalizeAccessMode(request.body?.accessMode);

        if (!Number.isInteger(cameraId) || cameraId <= 0) {
            return reply.code(400).send({ success: false, message: 'Camera ID is required' });
        }

        if (!segmentFilename) {
            return reply.code(400).send({ success: false, message: 'Segment filename is required' });
        }

        const camera = cameraService.getCameraById(cameraId);
        if (!camera?.enabled) {
            return reply.code(400).send({ success: false, message: 'Camera is disabled' });
        }

        // A valid token outranks whatever the client claimed: it is server-verified, so it is the
        // honest answer for both the mode and the attribution.
        const token = accessMode === 'admin_full' ? null : resolveViewerToken(request, cameraId);
        const effectiveMode = token ? 'token_full' : accessMode;

        const sessionId = playbackViewerSessionService.startSession({
            cameraId,
            cameraName: camera.name,
            segmentFilename,
            segmentStartedAt,
            accessMode: effectiveMode,
            adminUserId: effectiveMode === 'admin_full' ? request.user?.id || null : null,
            adminUsername: effectiveMode === 'admin_full' ? request.user?.username || null : null,
            tokenId: token?.id || null,
            tokenLabel: token?.label || null,
        }, request);

        return reply.send({
            success: true,
            data: { sessionId },
        });
    } catch (error) {
        console.error('Start playback viewer session error:', error);
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: error.message });
        }
        return reply.code(500).send({ success: false, message: 'Failed to start playback viewer session' });
    }
}

export async function playbackViewerHeartbeat(request, reply) {
    try {
        const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId.trim() : '';
        if (!sessionId) {
            return reply.code(400).send({ success: false, message: 'Session ID is required' });
        }

        const success = playbackViewerSessionService.heartbeat(sessionId);
        return reply.send({
            success,
            message: success ? 'Heartbeat received' : 'Session not found or expired',
        });
    } catch (error) {
        console.error('Playback viewer heartbeat error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to process heartbeat' });
    }
}

export async function stopPlaybackViewerSession(request, reply) {
    try {
        const sessionId = typeof request.body?.sessionId === 'string' ? request.body.sessionId.trim() : '';
        if (!sessionId) {
            return reply.code(400).send({ success: false, message: 'Session ID is required' });
        }

        const success = playbackViewerSessionService.endSession(sessionId);
        return reply.send({
            success,
            message: success ? 'Session ended' : 'Session not found or already ended',
        });
    } catch (error) {
        console.error('Stop playback viewer session error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to end playback viewer session' });
    }
}

export async function getActivePlaybackViewers(request, reply) {
    try {
        const cameraId = request.query?.cameraId || null;
        const accessMode = request.query?.accessMode || '';
        const sessions = playbackViewerSessionService.getActiveSessions({ cameraId, accessMode });

        return reply.send({
            success: true,
            data: {
                totalViewers: sessions.length,
                sessions,
            },
        });
    } catch (error) {
        console.error('Get active playback viewers error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to get active playback viewers' });
    }
}

export async function getPlaybackViewerStats(request, reply) {
    try {
        const cameraId = request.query?.cameraId || null;
        const accessMode = request.query?.accessMode || '';
        return reply.send({
            success: true,
            data: playbackViewerSessionService.getStats({ cameraId, accessMode }),
        });
    } catch (error) {
        console.error('Get playback viewer stats error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to get playback viewer stats' });
    }
}

export async function getPlaybackViewerHistory(request, reply) {
    try {
        return reply.send({
            success: true,
            data: playbackViewerSessionService.getHistoryPage({
                period: request.query?.period || '7days',
                page: request.query?.page,
                pageSize: request.query?.pageSize,
                cameraId: request.query?.cameraId || null,
                accessMode: request.query?.accessMode || '',
                deviceType: request.query?.deviceType || '',
                search: request.query?.search || '',
                sortBy: request.query?.sortBy || 'started_at',
                sortDirection: request.query?.sortDirection || 'desc',
            }),
        });
    } catch (error) {
        console.error('Get playback viewer history error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to get playback viewer history' });
    }
}

export async function getPlaybackViewerAnalytics(request, reply) {
    try {
        const period = request.query?.period || '7days';
        const cameraId = request.query?.cameraId || null;
        const accessMode = request.query?.accessMode || '';

        return reply.send({
            success: true,
            data: playbackViewerSessionService.getAnalytics(period, { cameraId, accessMode }),
        });
    } catch (error) {
        console.error('Get playback viewer analytics error:', error);
        return reply.code(500).send({ success: false, message: 'Failed to get playback viewer analytics' });
    }
}
