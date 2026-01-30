/**
 * Stream Token Service
 * Handles secure stream access with token-based authentication
 */

import apiClient from './apiClient';

// Token cache to avoid repeated API calls
// Key: cameraId, Value: { token, streamUrl, expiresAt }
const tokenCache = new Map();

// Cleanup expired tokens every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [cameraId, data] of tokenCache.entries()) {
        if (now >= data.expiresAt) {
            tokenCache.delete(cameraId);
        }
    }
}, 300000); // 5 minutes

/**
 * Get stream URL with valid token
 * Returns cached token if still valid, otherwise requests new token
 * 
 * @param {number} cameraId - Camera ID
 * @returns {Promise<{streamUrl: string, token: string}>}
 */
export const getSecureStreamUrl = async (cameraId) => {
    // Check cache first
    const cached = tokenCache.get(cameraId);
    if (cached && Date.now() < cached.expiresAt - 60000) { // Refresh 1 min before expiry
        return {
            streamUrl: cached.streamUrl,
            token: cached.token,
        };
    }

    try {
        // Request new token from backend
        const response = await apiClient.get(`/api/stream/${cameraId}/token`);
        
        if (!response.data.success) {
            throw new Error(response.data.message || 'Failed to get stream token');
        }

        const { token, streamUrl, expiresIn } = response.data.data;
        
        // Cache token with expiration time
        tokenCache.set(cameraId, {
            token,
            streamUrl,
            expiresAt: Date.now() + (expiresIn * 1000), // Convert seconds to ms
        });

        return { streamUrl, token };
    } catch (error) {
        console.error('Failed to get stream token:', error);
        throw error;
    }
};

/**
 * Build complete HLS URL with token query parameter
 * 
 * @param {string} baseUrl - Base HLS URL (e.g., /hls/uuid/index.m3u8)
 * @param {string} token - Stream access token
 * @returns {string} Complete URL with token
 */
export const buildSecureStreamUrl = (baseUrl, token) => {
    const url = new URL(baseUrl, window.location.origin);
    url.searchParams.set('token', token);
    return url.toString();
};

/**
 * Clear token cache for specific camera or all cameras
 * 
 * @param {number|null} cameraId - Camera ID to clear, or null for all
 */
export const clearTokenCache = (cameraId = null) => {
    if (cameraId === null) {
        tokenCache.clear();
    } else {
        tokenCache.delete(cameraId);
    }
};

/**
 * Preload tokens for multiple cameras
 * Useful for grid view to avoid sequential token requests
 * 
 * @param {number[]} cameraIds - Array of camera IDs
 * @returns {Promise<void>}
 */
export const preloadStreamTokens = async (cameraIds) => {
    const promises = cameraIds.map(id => 
        getSecureStreamUrl(id).catch(err => {
            console.warn(`Failed to preload token for camera ${id}:`, err);
            return null;
        })
    );
    
    await Promise.allSettled(promises);
};

export default {
    getSecureStreamUrl,
    buildSecureStreamUrl,
    clearTokenCache,
    preloadStreamTokens,
};
