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
 * Get a LIVE stream grant from a PLAYBACK token (for non-account token holders).
 *
 * The playback token travels as the HttpOnly cookie set at activation, so this GET needs no explicit
 * credential — the backend reads the cookie, checks the token covers this camera AND carries the live
 * entitlement, and returns BOTH the short-lived stream_access token and the HLS URL. That is why this
 * path does NOT call the canViewLive-gated /api/stream/:id or /token endpoints (which a token holder
 * is not entitled to): the live-token response already carries everything the player needs.
 *
 * @param {number} cameraId
 * @returns {Promise<{streamUrl: string, token: string, expiresIn: number}>}
 * @throws on 401/403 (token missing/does not allow live for this camera), 402 (suspended), 404.
 */
export const getLiveGrant = async (cameraId) => {
    const response = await apiClient.get(`/api/stream/${cameraId}/live-token`, {
        skipGlobalErrorNotification: true,
    });
    if (!response.data?.success) {
        throw new Error(response.data?.message || 'Gagal mendapatkan akses live');
    }
    const { token, streamUrl, expiresIn } = response.data.data;
    return { token, streamUrl, expiresIn };
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
    getLiveGrant,
    buildSecureStreamUrl,
    clearTokenCache,
    preloadStreamTokens,
};
