/**
 * Purpose: Register recording control, assurance, restart log, and playback segment HTTP routes.
 * Caller: backend/server.js under the /api prefix.
 * Deps: recordingController handlers and auth middleware.
 * MainFuncs: recordingRoutes().
 * SideEffects: Adds protected admin recording routes and optional-auth playback routes to Fastify.
 */

import {
    startRecording,
    stopRecording,
    getRecordingStatus,
    getRecordingsOverview,
    getRecordingAssurance,
    getSegments,
    streamSegment,
    generatePlaylist,
    getRestartLogs,
    updateRecordingSettings,
    streamOwnerArchiveSegment
} from '../controllers/recordingController.js';
import { authMiddleware, optionalAuthMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

// Params/querystring were previously unvalidated — `?limit=abc` reached handlers as a string
// and a path-traversal :cameraId/:filename fell through to the service layer. cameraId is
// digits-only; filename follows the segment-stamp policy (YYYYMMDD_HHMMSS.mp4 — no '/', no '..').
const cameraIdParamSchema = {
    type: 'object',
    required: ['cameraId'],
    properties: { cameraId: { type: 'string', pattern: '^[0-9]+$' } }
};
const restartLimitQuerySchema = {
    type: 'object',
    properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } },
    additionalProperties: false
};
const segmentStreamParamSchema = {
    type: 'object',
    required: ['cameraId', 'filename'],
    properties: {
        cameraId: { type: 'string', pattern: '^[0-9]+$' },
        filename: { type: 'string', pattern: '^\\d{8}_\\d{6}\\.mp4$' }
    }
};

/**
 * Recording Routes
 * Admin routes untuk recording management dan public routes untuk playback
 */
export default async function recordingRoutes(fastify) {
    // ============================================
    // ADMIN ROUTES (Protected)
    // ============================================
    
    // IMPORTANT: Static routes MUST come before dynamic routes
    // Otherwise /recordings/overview will match /recordings/:cameraId

    // Get recordings overview (dashboard) - MUST BE FIRST
    fastify.get('/recordings/overview', {
        onRequest: [authMiddleware]
    }, getRecordingsOverview);

    // Get recording assurance snapshot - MUST BE BEFORE :cameraId routes
    fastify.get('/recordings/assurance', {
        onRequest: [authMiddleware]
    }, getRecordingAssurance);

    // Get restart logs - MUST BE BEFORE :cameraId routes
    fastify.get('/recordings/restarts', {
        onRequest: [authMiddleware],
        schema: { querystring: restartLimitQuerySchema }
    }, getRestartLogs);

    // Start recording
    fastify.post('/recordings/:cameraId/start', {
        onRequest: [authMiddleware, requireAdmin],
        schema: { params: cameraIdParamSchema }
    }, startRecording);

    // Stop recording
    fastify.post('/recordings/:cameraId/stop', {
        onRequest: [authMiddleware, requireAdmin],
        schema: { params: cameraIdParamSchema }
    }, stopRecording);

    // Get recording status
    fastify.get('/recordings/:cameraId/status', {
        onRequest: [authMiddleware],
        schema: { params: cameraIdParamSchema }
    }, getRecordingStatus);

    // Update recording settings
    fastify.put('/recordings/:cameraId/settings', {
        onRequest: [authMiddleware, requireAdmin],
        schema: { params: cameraIdParamSchema }
    }, updateRecordingSettings);

    // Get restart logs for specific camera
    fastify.get('/recordings/:cameraId/restarts', {
        onRequest: [authMiddleware],
        schema: { params: cameraIdParamSchema, querystring: restartLimitQuerySchema }
    }, getRestartLogs);

    // ============================================
    // PUBLIC ROUTES (Playback)
    // ============================================

    // Get segments untuk camera (untuk playback UI)
    fastify.get('/recordings/:cameraId/segments', {
        onRequest: [optionalAuthMiddleware],
        schema: { params: cameraIdParamSchema }
    }, getSegments);

    // Stream ONE archived (Telegram) segment to the camera's OWNER. Static 'archive' is registered
    // before the dynamic :cameraId route. optionalAuth (like the local stream route) so the global
    // customer lockout hook does not block it; ownership + billing are re-checked server-side. (P-01)
    fastify.get('/recordings/archive/:segmentId/stream', {
        onRequest: [optionalAuthMiddleware],
        schema: {
            params: {
                type: 'object',
                required: ['segmentId'],
                properties: { segmentId: { type: 'integer', minimum: 1 } },
            },
        },
    }, streamOwnerArchiveSegment);

    // Stream segment file
    fastify.get('/recordings/:cameraId/stream/:filename', {
        onRequest: [optionalAuthMiddleware],
        schema: { params: segmentStreamParamSchema }
    }, streamSegment);

    // Generate HLS playlist
    fastify.get('/recordings/:cameraId/playlist.m3u8', {
        onRequest: [optionalAuthMiddleware],
        schema: { params: cameraIdParamSchema }
    }, generatePlaylist);
}
