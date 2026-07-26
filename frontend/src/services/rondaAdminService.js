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
};

export default rondaAdminService;
