/*
 * Purpose: Admin API client for Ronda Digital motion-detector settings (alert window, Telegram
 *          group, sensitivity) served from /api/admin/ronda.
 * Caller: pages/RondaSettings.jsx (admin).
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: getCameras, updateCamera.
 * SideEffects: HTTP requests only.
 */

import apiClient from './apiClient';

export const rondaAdminService = {
    async getCameras() {
        const response = await apiClient.get('/api/admin/ronda/cameras');
        return response.data;
    },

    async updateCamera(name, patch) {
        const response = await apiClient.put(`/api/admin/ronda/cameras/${encodeURIComponent(name)}`, patch);
        return response.data;
    },

    async getAvailableCameras() {
        const response = await apiClient.get('/api/admin/ronda/available');
        return response.data;
    },

    async createCamera(payload) {
        const response = await apiClient.post('/api/admin/ronda/cameras', payload);
        return response.data;
    },

    async restartCamera(name) {
        const response = await apiClient.post(`/api/admin/ronda/cameras/${encodeURIComponent(name)}/restart`);
        return response.data;
    },

    async deleteCamera(name) {
        const response = await apiClient.delete(`/api/admin/ronda/cameras/${encodeURIComponent(name)}`);
        return response.data;
    },

    // Fetched as a blob (not a plain <img src>) so it travels the same authenticated path as every
    // other admin call — the detector frames are not public.
    async getPreviewBlob(name) {
        const response = await apiClient.get(
            `/api/admin/ronda/cameras/${encodeURIComponent(name)}/preview.jpg`,
            { responseType: 'blob' },
        );
        return response.data;
    },
};

export default rondaAdminService;
