/*
 * Purpose: Frontend API client for activating and managing playback access tokens.
 * Caller: public playback token UI and admin playback token management page.
 * Deps: apiClient.
 * MainFuncs: activateToken, heartbeatToken, clearToken, listTokens, listAuditLogs, createToken, shareToken, clearSessions, revokeToken.
 * SideEffects: Sends token activation and admin token management requests to backend.
 */

import apiClient from './apiClient';

export const playbackTokenService = {
    async activateToken(token, cameraId = null, clientId = '') {
        const response = await apiClient.post('/api/playback-token/activate', {
            token,
            camera_id: cameraId,
            client_id: clientId,
        });
        return response.data;
    },

    async activateShareKey(shareKey, cameraId = null, clientId = '') {
        const response = await apiClient.post('/api/playback-token/activate', {
            share_key: shareKey,
            camera_id: cameraId,
            client_id: clientId,
        });
        return response.data;
    },

    async heartbeatToken(cameraId = null) {
        const response = await apiClient.post('/api/playback-token/heartbeat', {
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

    async listAuditLogs(limit = 50) {
        const response = await apiClient.get(`/api/admin/playback-tokens/audit?limit=${limit}`);
        return response.data;
    },

    async createToken(payload) {
        const response = await apiClient.post('/api/admin/playback-tokens', payload);
        return response.data;
    },

    async shareToken(id) {
        const response = await apiClient.post(`/api/admin/playback-tokens/${id}/share`);
        return response.data;
    },

    async clearSessions(id) {
        const response = await apiClient.post(`/api/admin/playback-tokens/${id}/sessions/clear`);
        return response.data;
    },

    async revokeToken(id) {
        const response = await apiClient.post(`/api/admin/playback-tokens/${id}/revoke`);
        return response.data;
    },
};

export default playbackTokenService;
