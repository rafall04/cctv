import playbackViewerSessionService from '../services/playbackViewerSessionService.js';
import cameraService from '../services/cameraService.js';

function normalizeAccessMode(value) {
    return value === 'admin_full' ? 'admin_full' : 'public_preview';
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

        const sessionId = playbackViewerSessionService.startSession({
            cameraId,
            cameraName: camera.name,
            segmentFilename,
            segmentStartedAt,
            accessMode,
            adminUserId: accessMode === 'admin_full' ? request.user?.id || null : null,
            adminUsername: accessMode === 'admin_full' ? request.user?.username || null : null,
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
