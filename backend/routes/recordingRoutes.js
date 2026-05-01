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
    updateRecordingSettings
} from '../controllers/recordingController.js';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';

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
    fastify.get('/recordings/:cameraId/segments', {
        onRequest: [optionalAuthMiddleware]
    }, getSegments);

    // Stream segment file
    fastify.get('/recordings/:cameraId/stream/:filename', {
        onRequest: [optionalAuthMiddleware]
    }, streamSegment);

    // Generate HLS playlist
    fastify.get('/recordings/:cameraId/playlist.m3u8', {
        onRequest: [optionalAuthMiddleware]
    }, generatePlaylist);
}
