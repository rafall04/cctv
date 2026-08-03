/*
 * Purpose: Frontend API client for activating and managing playback access tokens.
 * Caller: public playback token UI and admin playback token management page.
 * Deps: apiClient.
 * MainFuncs: activateToken, heartbeatToken, clearToken, listTokens, listAuditLogs, createToken, updateToken, shareToken, clearSessions, revokeToken.
 * SideEffects: Sends token activation and admin token management requests to backend.
 */

import apiClient from './apiClient';

/**
 * Admin token-management methods follow the shared catch-and-return contract:
 * they never throw and return `{ success: false, message }` on error.
 * The public playback methods (activate/heartbeat/clear) keep throwing — that
 * flow is driven by usePlaybackTokenAccess and is out of the admin scope.
 */
function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

/*
 * These three authenticate with the playback-token cookie, never the admin JWT, so a 401
 * from them means "this playback token is not valid" — never "your login expired". Without
 * this flag the shared interceptor treated their 401 as an expired JWT and chased it with a
 * POST /api/auth/refresh, which an anonymous visitor also failed: one public page view
 * produced two red console errors and a spurious session-expiry teardown.
 */
const PUBLIC_TOKEN_REQUEST = { skipAuthRefresh: true };

export const playbackTokenService = {
    async activateToken(token, cameraId = null, clientId = '') {
        const response = await apiClient.post('/api/playback-token/activate', {
            token,
            camera_id: cameraId,
            client_id: clientId,
        }, PUBLIC_TOKEN_REQUEST);
        return response.data;
    },

    async activateShareKey(shareKey, cameraId = null, clientId = '') {
        const response = await apiClient.post('/api/playback-token/activate', {
            share_key: shareKey,
            camera_id: cameraId,
            client_id: clientId,
        }, PUBLIC_TOKEN_REQUEST);
        return response.data;
    },

    async heartbeatToken(cameraId = null) {
        const response = await apiClient.post('/api/playback-token/heartbeat', {
            camera_id: cameraId,
        }, PUBLIC_TOKEN_REQUEST);
        return response.data;
    },

    async clearToken() {
        const response = await apiClient.post('/api/playback-token/clear', {}, PUBLIC_TOKEN_REQUEST);
        return response.data;
    },

    async listTokens() {
        try {
            const response = await apiClient.get('/api/admin/playback-tokens');
            return response.data;
        } catch (error) {
            console.error('List playback tokens error:', error);
            return failure(error, 'Gagal memuat token playback');
        }
    },

    /** `tokenId` narrows the trail to one token — the backend has always supported it. */
    async listAuditLogs(limit = 50, tokenId = null) {
        try {
            const params = new URLSearchParams({ limit: String(limit) });
            if (tokenId) params.set('tokenId', String(tokenId));
            const response = await apiClient.get(`/api/admin/playback-tokens/audit?${params}`);
            return response.data;
        } catch (error) {
            console.error('List playback token audit logs error:', error);
            return failure(error, 'Gagal memuat log token');
        }
    },

    async createToken(payload) {
        try {
            const response = await apiClient.post('/api/admin/playback-tokens', payload);
            return response.data;
        } catch (error) {
            console.error('Create playback token error:', error);
            return failure(error, 'Gagal membuat token');
        }
    },

    async updateToken(id, payload) {
        try {
            const response = await apiClient.put(`/api/admin/playback-tokens/${id}`, payload);
            return response.data;
        } catch (error) {
            console.error('Update playback token error:', error);
            return failure(error, 'Gagal memperbarui token');
        }
    },

    async shareToken(id) {
        try {
            const response = await apiClient.post(`/api/admin/playback-tokens/${id}/share`);
            return response.data;
        } catch (error) {
            console.error('Share playback token error:', error);
            return failure(error, 'Gagal membuat tautan share token');
        }
    },

    async clearSessions(id) {
        try {
            const response = await apiClient.post(`/api/admin/playback-tokens/${id}/sessions/clear`);
            return response.data;
        } catch (error) {
            console.error('Clear playback token sessions error:', error);
            return failure(error, 'Gagal mereset sesi token');
        }
    },

    async revokeToken(id) {
        try {
            const response = await apiClient.post(`/api/admin/playback-tokens/${id}/revoke`);
            return response.data;
        } catch (error) {
            console.error('Revoke playback token error:', error);
            return failure(error, 'Gagal mencabut token');
        }
    },

    /** Permanent, unlike revoke — the row goes, so trial tokens stop piling up as dead clutter. */
    async deleteToken(id) {
        try {
            const response = await apiClient.delete(`/api/admin/playback-tokens/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete playback token error:', error);
            return failure(error, 'Gagal menghapus token');
        }
    },
};

export default playbackTokenService;
