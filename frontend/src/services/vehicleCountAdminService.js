/*
 * Purpose: Admin API client for per-camera vehicle-counting settings.
 * Caller: pages/VehicleCountSettings.jsx, components/admin/vehicle-count/*.
 * Deps: apiClient.
 * MainFuncs: listCameras, listAvailable, getCamera, saveCamera, removeCamera.
 * SideEffects: Performs authenticated admin requests.
 */

import apiClient from './apiClient';

const BASE = '/api/admin/vehicle-count';

export const vehicleCountAdminService = {
    async listCameras() {
        const { data } = await apiClient.get(`${BASE}/cameras`);
        return data;
    },

    async listAvailable() {
        const { data } = await apiClient.get(`${BASE}/available`);
        return data;
    },

    async getCamera(cameraId) {
        const { data } = await apiClient.get(`${BASE}/cameras/${cameraId}`);
        return data;
    },

    /** Ringkasan hitungan + kesehatan proses; null bila kamera itu belum pernah jalan. */
    async getSummary(cameraId) {
        const { data } = await apiClient.get(`${BASE}/cameras/${cameraId}/ringkasan`);
        return data;
    },

    async saveCamera(cameraId, payload) {
        const { data } = await apiClient.put(`${BASE}/cameras/${cameraId}`, payload);
        return data;
    },

    async removeCamera(cameraId) {
        const { data } = await apiClient.delete(`${BASE}/cameras/${cameraId}`);
        return data;
    },
};

export default vehicleCountAdminService;
