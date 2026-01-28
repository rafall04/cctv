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
    
    // IMPORTANT: Static routes MUST come before dynamic routes
    // Otherwise /recordings/overview will match /recordings/:cameraId

    // Get recordings overview (dashboard) - MUST BE FIRST
    fastify.get('/recordings/overview', {
        onRequest: [authMiddleware]
    }, getRecordingsOverview);

    // Get restart logs - MUST BE BEFORE :cameraId routes
    fastify.get('/recordings/restarts', {
        onRequest: [authMiddleware]
    }, getRestartLogs);

    // Start recording
    fastify.post('/recordings/:cameraId/start', {
        onRequest: [authMiddleware]
    }, startRecording);

    // Stop recording
    fastify.post('/recordings/:cameraId/stop', {
        onRequest: [authMiddleware]
    }, stopRecording);

    // Get recording status
    fastify.get('/recordings/:cameraId/status', {
        onRequest: [authMiddleware]
    }, getRecordingStatus);

    // Update recording settings
    fastify.put('/recordings/:cameraId/settings', {
        onRequest: [authMiddleware]
    }, updateRecordingSettings);

    // Get restart logs for specific camera
    fastify.get('/recordings/:cameraId/restarts', {
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
