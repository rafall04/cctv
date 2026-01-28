import {
    startRecording,
    stopRecording,
    getRecordingStatus,
    getRecordingsOverview,
    getSegments,
    streamSegment,
    generatePlaylist,
    getRestartLogs,
    updateRecordingSettings
} from '../controllers/recordingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

/**
 * Recording Routes
 * Admin routes untuk recording management dan public routes untuk playback
 */
export default async function recordingRoutes(fastify) {
    // ============================================
    // ADMIN ROUTES (Protected)
    // ============================================

    // Start recording
    fastify.post('/admin/recordings/:cameraId/start', {
        onRequest: [authMiddleware]
    }, startRecording);

    // Stop recording
    fastify.post('/admin/recordings/:cameraId/stop', {
        onRequest: [authMiddleware]
    }, stopRecording);

    // Get recording status
    fastify.get('/admin/recordings/:cameraId/status', {
        onRequest: [authMiddleware]
    }, getRecordingStatus);

    // Get recordings overview (dashboard)
    fastify.get('/admin/recordings/overview', {
        onRequest: [authMiddleware]
    }, getRecordingsOverview);

    // Update recording settings
    fastify.put('/admin/recordings/:cameraId/settings', {
        onRequest: [authMiddleware]
    }, updateRecordingSettings);

    // Get restart logs
    fastify.get('/admin/recordings/restarts', {
        onRequest: [authMiddleware]
    }, getRestartLogs);

    fastify.get('/admin/recordings/:cameraId/restarts', {
        onRequest: [authMiddleware]
    }, getRestartLogs);

    // ============================================
    // PUBLIC ROUTES (Playback)
    // ============================================

    // Get segments untuk camera (untuk playback UI)
    fastify.get('/recordings/:cameraId/segments', getSegments);

    // Stream segment file
    fastify.get('/recordings/:cameraId/stream/:filename', streamSegment);

    // Generate HLS playlist
    fastify.get('/recordings/:cameraId/playlist.m3u8', generatePlaylist);
}
