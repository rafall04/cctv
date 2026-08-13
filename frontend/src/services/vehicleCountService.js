/*
 * Purpose: Fetch automatic vehicle-count telemetry for the showcase camera.
 * Caller: components/landing/CameraVehicleCountPanel.jsx.
 * Deps: apiClient.
 * MainFuncs: vehicleCountService.getForCamera.
 * SideEffects: Performs public GET requests.
 */

import apiClient from './apiClient';

const publicRequestConfig = {
    skipGlobalErrorNotification: true,
    skipAuthRefresh: true,
};

export const vehicleCountService = {
    /**
     * @param {string} pada  Jam frame yang sedang ditonton (ISO). Diisi supaya angka yang
     *                       dikembalikan SAMA dengan yang tergambar di frame itu, bukan
     *                       angka detik ini yang selalu lebih maju daripada video.
     */
    async getForCamera(cameraId, pada = '') {
        const response = await apiClient.get(
            `/api/public/vehicle-count/${encodeURIComponent(cameraId)}`,
            pada ? { ...publicRequestConfig, params: { pada } } : publicRequestConfig
        );
        return response.data;
    },
};

export default vehicleCountService;
