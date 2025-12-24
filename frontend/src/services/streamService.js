import apiClient from './apiClient';

/**
 * Stream Service
 * 
 * Handles fetching stream URLs from backend API.
 * 
 * ARCHITECTURE:
 * Frontend -> Backend API -> MediaMTX (internal)
 * Frontend NEVER accesses MediaMTX directly!
 * 
 * Stream URLs can be:
 * 1. Relative paths (e.g., /hls/camera1/index.m3u8)
 *    - Frontend prepends API base URL
 * 2. Absolute URLs (e.g., https://api-cctv.raf.my.id/hls/camera1/index.m3u8)
 *    - Used directly
 */

// Get the API base URL for constructing full stream URLs
const getStreamBaseUrl = () => {
    // Use the same base URL as the API client
    return import.meta.env.VITE_API_URL || 'https://api-cctv.raf.my.id';
};

/**
 * Convert stream URLs to absolute URLs if they are relative
 * 
 * @param {Object} streams - Stream URLs object { hls, webrtc }
 * @returns {Object} - Stream URLs with absolute paths
 */
const makeStreamUrlsAbsolute = (streams) => {
    if (!streams) return streams;
    
    const baseUrl = getStreamBaseUrl();
    
    // Helper to make a single URL absolute
    const makeAbsolute = (url) => {
        if (!url) return url;
        
        // Already absolute URL (starts with http:// or https://)
        if (url.startsWith('http://') || url.startsWith('https://')) {
            return url;
        }
        
        // Relative URL - prepend base URL
        // Ensure proper path joining
        const cleanBase = baseUrl.replace(/\/$/, '');
        const cleanPath = url.startsWith('/') ? url : `/${url}`;
        return `${cleanBase}${cleanPath}`;
    };
    
    return {
        hls: makeAbsolute(streams.hls),
        webrtc: makeAbsolute(streams.webrtc),
    };
};

export const streamService = {
    // Get all active streams (public)
    async getAllActiveStreams() {
        try {
            const response = await apiClient.get('/api/stream');
            
            // Convert relative stream URLs to absolute URLs
            if (response.data?.success && response.data?.data) {
                response.data.data = response.data.data.map(camera => ({
                    ...camera,
                    streams: makeStreamUrlsAbsolute(camera.streams),
                }));
            }
            
            return response.data;
        } catch (error) {
            console.error('Get all active streams error:', error);
            throw error;
        }
    },

    // Get stream URLs for specific camera (public)
    async getStreamUrls(cameraId) {
        try {
            const response = await apiClient.get(`/api/stream/${cameraId}`);
            
            // Convert relative stream URLs to absolute URLs
            if (response.data?.success && response.data?.data?.streams) {
                response.data.data.streams = makeStreamUrlsAbsolute(response.data.data.streams);
            }
            
            return response.data;
        } catch (error) {
            console.error('Get stream URLs error:', error);
            throw error;
        }
    },
};

export default streamService;
