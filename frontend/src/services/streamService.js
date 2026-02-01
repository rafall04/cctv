import apiClient from './apiClient';
import { getApiUrl } from '../config/config.js';

/**
 * Get base URL for API/backend from central config
 * Used for HLS proxy which routes through backend for session tracking
 */
const getApiBaseUrl = () => {
    return getApiUrl();
};

/**
 * Convert HLS URL to use backend proxy for automatic session tracking
 * This ensures ALL viewers (frontend, VLC, direct URL) are tracked
 * 
 * Format: /hls/{uuid}/index.m3u8
 * Example: https://api.your-domain.com/hls/04bd5387-9db4-4cf0-9f8d-7fb42cc76263/index.m3u8
 */
const convertToProxyHlsUrl = (hlsUrl) => {
    if (!hlsUrl) return hlsUrl;
    
    const baseUrl = getApiBaseUrl();
    
    // UUID pattern: 8-4-4-4-12 hex characters
    const uuidPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    
    let streamPath = null;
    
    if (hlsUrl.includes('/hls/')) {
        // Proxy format: /hls/{uuid}/index.m3u8
        const match = hlsUrl.match(new RegExp(`/hls/(${uuidPattern})`, 'i'));
        streamPath = match ? match[1] : null;
    } else {
        // Direct MediaMTX URL: http://host:port/{uuid}/index.m3u8
        const match = hlsUrl.match(new RegExp(`/(${uuidPattern})/index\\.m3u8`, 'i'));
        streamPath = match ? match[1] : null;
    }
    
    if (streamPath) {
        return `${baseUrl}/hls/${streamPath}/index.m3u8`;
    }
    
    return hlsUrl;
};

const makeStreamUrlsAbsolute = (streams) => {
    if (!streams) return streams;
    
    const baseUrl = getApiBaseUrl();
    
    const makeAbsolute = (url) => {
        if (!url) return url;
        
        // If URL is already absolute, ensure it uses HTTPS in production
        if (url.startsWith('http://') || url.startsWith('https://')) {
            // Force HTTPS if the page is loaded over HTTPS (production)
            if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
                return url.replace(/^http:\/\//i, 'https://');
            }
            return url;
        }
        
        // Relative URL - prepend base URL
        const cleanBase = baseUrl.replace(/\/$/, '');
        const cleanPath = url.startsWith('/') ? url : `/${url}`;
        return `${cleanBase}${cleanPath}`;
    };
    
    return {
        // Use backend HLS proxy for automatic session tracking
        hls: convertToProxyHlsUrl(streams.hls),
        webrtc: makeAbsolute(streams.webrtc),
    };
};

export const streamService = {
    async getAllActiveStreams() {
        try {
            const response = await apiClient.get('/api/stream');
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

    async getStreamUrls(cameraId) {
        try {
            const response = await apiClient.get(`/api/stream/${cameraId}`);
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
