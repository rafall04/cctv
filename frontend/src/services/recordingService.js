import apiClient from './apiClient';

/**
 * Recording Service - Frontend API calls
 */

/**
 * Get base URL for API/backend
 * Handles both domain and IP-based access
 */
const getApiBaseUrl = () => {
    if (typeof window !== 'undefined') {
        const hostname = window.location.hostname;
        const protocol = window.location.protocol;
        
        // If accessing via IP address, use relative path (Nginx will proxy)
        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) {
            return ''; // Empty string = relative path
        }
        
        // If HTTPS with domain, use HTTPS API domain
        if (protocol === 'https:' && hostname === 'cctv.raf.my.id') {
            return 'https://api-cctv.raf.my.id';
        }
        
        // HTTP with domain
        if (hostname === 'cctv.raf.my.id') {
            return 'http://api-cctv.raf.my.id';
        }
    }
    
    // Fallback for development
    return import.meta.env.VITE_API_URL || 'http://localhost:3001';
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
export const getRecordingsOverview = async () => {
    const response = await apiClient.get('/api/recordings/overview');
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
export const getRestartLogs = async (cameraId = null, limit = 50) => {
    const url = cameraId 
        ? `/api/recordings/${cameraId}/restarts?limit=${limit}`
        : `/api/recordings/restarts?limit=${limit}`;
    const response = await apiClient.get(url);
    return response.data;
};

// ============================================
// PUBLIC - Playback
// ============================================

/**
 * Get segments untuk camera (untuk playback)
 */
export const getSegments = async (cameraId) => {
    const response = await apiClient.get(`/api/recordings/${cameraId}/segments`);
    return response.data;
};

/**
 * Get stream URL untuk segment
 */
export const getSegmentStreamUrl = (cameraId, filename) => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/recordings/${cameraId}/stream/${filename}`;
};

/**
 * Get HLS playlist URL untuk seamless playback
 */
export const getPlaylistUrl = (cameraId) => {
    const baseUrl = getApiBaseUrl();
    return `${baseUrl}/api/recordings/${cameraId}/playlist.m3u8`;
};

export default {
    startRecording,
    stopRecording,
    getRecordingStatus,
    getRecordingsOverview,
    updateRecordingSettings,
    getRestartLogs,
    getSegments,
    getSegmentStreamUrl,
    getPlaylistUrl
};
