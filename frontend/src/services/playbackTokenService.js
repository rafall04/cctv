/*
 * Purpose: Frontend API client for activating and managing playback access tokens.
 * Caller: public playback token UI and admin playback token management page.
 * Deps: apiClient.
 * MainFuncs: activateToken, clearToken, listTokens, createToken, revokeToken.
 * SideEffects: Sends token activation and admin token management requests to backend.
 */

import apiClient from './apiClient';

export const playbackTokenService = {
    async activateToken(token, cameraId = null) {
        const response = await apiClient.post('/api/playback-token/activate', {
            token,
            camera_id: cameraId,
        });
        return response.data;
    },

    async clearToken() {
        const response = await apiClient.post('/api/playback-token/clear');
        return response.data;
    },

    async listTokens() {
        const response = await apiClient.get('/api/admin/playback-tokens');
        return response.data;
    },

    async createToken(payload) {
        const response = await apiClient.post('/api/admin/playback-tokens', payload);
        return response.data;
    },

    async revokeToken(id) {
        const response = await apiClient.post(`/api/admin/playback-tokens/${id}/revoke`);
        return response.data;
    },
};

export default playbackTokenService;
