import apiClient from './apiClient';

const getStreamBaseUrl = () => {
    return import.meta.env.VITE_API_URL || 'https://api-cctv.raf.my.id';
};

const makeStreamUrlsAbsolute = (streams) => {
    if (!streams) return streams;
    
    const baseUrl = getStreamBaseUrl();
    
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
        hls: makeAbsolute(streams.hls),
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
