import apiClient from './apiClient';
import { getApiUrl } from '../config/config.js';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

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

/**
 * Convert external HLS URL to use backend proxy to evade Browser CORS restrictions
 * Format: /hls/proxy?url={encoded_url}
 */
const convertToExternalProxyUrl = (externalUrl, cameraId = null) => {
    if (!externalUrl) return externalUrl;

    // Only proxy http/https URLs (avoid modifying already proxied or local URLs)
    if (!externalUrl.startsWith('http://') && !externalUrl.startsWith('https://')) {
        return externalUrl;
    }

    const baseUrl = getApiBaseUrl();
    const query = new URLSearchParams({
        url: externalUrl,
    });

    if (cameraId !== null && cameraId !== undefined) {
        query.set('cameraId', String(cameraId));
    }

    return `${baseUrl}/hls/proxy?${query.toString()}`;
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
    async getAllActiveStreams(policy = REQUEST_POLICY.SILENT_PUBLIC, config = {}) {
        try {
            const response = await apiClient.get('/api/stream', getRequestPolicyConfig(policy, config));
            if (response.data?.success && response.data?.data) {
                response.data.data = response.data.data.map(camera => {
                    let processedStreams = camera.streams;

                    if (camera.stream_source === 'external') {
                        if (processedStreams && processedStreams.hls) {
                            processedStreams = {
                                ...processedStreams,
                                hls: convertToExternalProxyUrl(processedStreams.hls, camera.id)
                            };
                        }
                    } else {
                        processedStreams = makeStreamUrlsAbsolute(processedStreams);
                    }

                    return {
                        ...camera,
                        streams: processedStreams
                    };
                });
            }
            return response.data;
        } catch (error) {
            console.error('Get all active streams error:', error);
            throw error;
        }
    },

    async getStreamUrls(cameraId, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get(
                `/api/stream/${cameraId}`,
                getRequestPolicyConfig(policy, config)
            );
            if (response.data?.success && response.data?.data?.streams) {
                const camera = response.data.data;
                let processedStreams = camera.streams;

                if (camera.stream_source === 'external') {
                    if (processedStreams && processedStreams.hls) {
                        processedStreams = {
                            ...processedStreams,
                            hls: convertToExternalProxyUrl(processedStreams.hls, camera.id)
                        };
                    }
                } else {
                    processedStreams = makeStreamUrlsAbsolute(processedStreams);
                }

                response.data.data.streams = processedStreams;
            }
            return response.data;
        } catch (error) {
            console.error('Get stream URLs error:', error);
            throw error;
        }
    },
};

export default streamService;
