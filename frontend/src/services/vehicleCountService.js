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
    async getForCamera(cameraId) {
        const response = await apiClient.get(
            `/api/public/vehicle-count/${encodeURIComponent(cameraId)}`,
            publicRequestConfig
        );
        return response.data;
    },
};

export default vehicleCountService;
