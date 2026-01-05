import apiClient from './apiClient';

export const settingsService = {
    // Public - get map default center
    getMapCenter: async () => {
        const response = await apiClient.get('/api/settings/map-center');
        return response.data;
    },

    // Admin - get all settings
    getAllSettings: async () => {
        const response = await apiClient.get('/api/settings');
        return response.data;
    },

    // Admin - update setting
    updateSetting: async (key, value, description) => {
        const response = await apiClient.put(`/api/settings/${key}`, { value, description });
        return response.data;
    },

    // Admin - update map center
    updateMapCenter: async (latitude, longitude, zoom, name) => {
        const response = await apiClient.put('/api/settings/map_default_center', {
            value: { latitude, longitude, zoom, name }
        });
        return response.data;
    },
};
