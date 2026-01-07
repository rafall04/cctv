import apiClient from './apiClient';

/**
 * Get base URL for API/backend
 * Used for HLS proxy which routes through backend for session tracking
 */
const getApiBaseUrl = () => {
    // In production (HTTPS), always use HTTPS with the API domain
    if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
        const hostname = window.location.hostname;
        if (hostname === 'cctv.raf.my.id') {
            return 'https://api-cctv.raf.my.id';
        }
        // Fallback: construct from current hostname
        return `https://${hostname.replace('cctv.', 'api-cctv.')}`;
    }
    return import.meta.env.VITE_API_URL || 'http://localhost:3000';
};

/**
 * Convert HLS URL to use backend proxy for automatic session tracking
 * This ensures ALL viewers (frontend, VLC, direct URL) are tracked
 * 
 * Original: /hls/camera1/index.m3u8 or http://localhost:8888/camera1/index.m3u8
 * Converted: https://api-cctv.raf.my.id/hls/camera1/index.m3u8
 */
const convertToProxyHlsUrl = (hlsUrl) => {
    if (!hlsUrl) return hlsUrl;
    
    const baseUrl = getApiBaseUrl();
    
    // Extract camera path from URL (e.g., "camera1")
    // Handles both relative (/hls/camera1/...) and absolute (http://localhost:8888/camera1/...)
    let cameraPath = null;
    
    if (hlsUrl.includes('/hls/')) {
        // Already using proxy format
        const match = hlsUrl.match(/\/hls\/(camera\d+)/);
        cameraPath = match ? match[1] : null;
    } else {
        // Direct MediaMTX URL format: http://host:port/camera1/index.m3u8
        const match = hlsUrl.match(/\/(camera\d+)\/index\.m3u8/);
        cameraPath = match ? match[1] : null;
    }
    
    if (cameraPath) {
        return `${baseUrl}/hls/${cameraPath}/index.m3u8`;
    }
    
    // Fallback: return original URL if can't parse
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
