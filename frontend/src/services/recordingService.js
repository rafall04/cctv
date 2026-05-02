/*
Purpose: Frontend API client for recording control, playback, restart logs, and assurance snapshots.
Caller: Admin recording dashboard, playback pages, and recording controls.
Deps: apiClient, request policy helpers, frontend config.
MainFuncs: startRecording, stopRecording, getRecordingsOverview, getRestartLogs, getRecordingAssurance, getSegments.
SideEffects: Issues HTTP requests to backend recording endpoints.
*/

import apiClient from './apiClient';
import { getApiUrl } from '../config/config.js';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

/**
 * Recording Service - Frontend API calls
 */

/**
 * Get base URL for API/backend from central config
 * Handles both domain and IP-based access
 */
const getApiBaseUrl = () => {
    return getApiUrl();
};

const buildPlaybackQuery = (accessScope = 'public') => {
    return accessScope === 'admin_full' ? '?scope=admin' : '';
};

// ============================================
// ADMIN - Recording Control
// ============================================

/**
 * Start recording untuk camera
 */
export const startRecording = async (cameraId, durationHours = 5) => {
    const response = await apiClient.post(`/api/recordings/${cameraId}/start`, {
        duration_hours: durationHours
    });
    return response.data;
};

/**
 * Stop recording untuk camera
 */
export const stopRecording = async (cameraId) => {
    const response = await apiClient.post(`/api/recordings/${cameraId}/stop`);
    return response.data;
};

/**
 * Get recording status untuk camera
 */
export const getRecordingStatus = async (cameraId) => {
    const response = await apiClient.get(`/api/recordings/${cameraId}/status`);
    return response.data;
};

/**
 * Get recordings overview (dashboard)
 */
export const getRecordingsOverview = async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
    const response = await apiClient.get('/api/recordings/overview', getRequestPolicyConfig(policy, config));
    return response.data;
};

/**
 * Update recording settings
 */
export const updateRecordingSettings = async (cameraId, settings) => {
    const response = await apiClient.put(`/api/recordings/${cameraId}/settings`, settings);
    return response.data;
};

/**
 * Get restart logs
 */
export const getRestartLogs = async (cameraId = null, limit = 50, policy = REQUEST_POLICY.BLOCKING, config = {}) => {
    const url = cameraId 
        ? `/api/recordings/${cameraId}/restarts?limit=${limit}`
        : `/api/recordings/restarts?limit=${limit}`;
    const response = await apiClient.get(url, getRequestPolicyConfig(policy, config));
    return response.data;
};

/**
 * Get recording assurance snapshot
 */
export const getRecordingAssurance = async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
    const response = await apiClient.get('/api/recordings/assurance', getRequestPolicyConfig(policy, config));
    return response.data;
};

// ============================================
// PUBLIC - Playback
// ============================================

/**
 * Get segments untuk camera (untuk playback)
 */
export const getSegments = async (cameraId, policy = REQUEST_POLICY.BLOCKING, config = {}, accessScope = 'public') => {
    const response = await apiClient.get(
        `/api/recordings/${cameraId}/segments${buildPlaybackQuery(accessScope)}`,
        getRequestPolicyConfig(policy, config)
    );
    return response.data;
};

/**
 * Get stream URL untuk segment
 */
export const getSegmentStreamUrl = (cameraId, filename, accessScope = 'public') => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/recordings/${cameraId}/stream/${filename}${buildPlaybackQuery(accessScope)}`;
};

/**
 * Get HLS playlist URL untuk seamless playback
 */
export const getPlaylistUrl = (cameraId, accessScope = 'public') => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/recordings/${cameraId}/playlist.m3u8${buildPlaybackQuery(accessScope)}`;
};

export default {
    startRecording,
    stopRecording,
    getRecordingStatus,
    getRecordingsOverview,
    updateRecordingSettings,
    getRestartLogs,
    getRecordingAssurance,
    getSegments,
    getSegmentStreamUrl,
    getPlaylistUrl
};
