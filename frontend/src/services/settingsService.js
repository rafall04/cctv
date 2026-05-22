import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

/**
 * Settings API client.
 *
 * Contract: methods never throw — on error they return
 * `{ success: false, message }`. Callers branch on `result.success`.
 */

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

export const settingsService = {
    // Public - get map default center
    getMapCenter: async () => {
        try {
            const response = await apiClient.get('/api/settings/map-center');
            return response.data;
        } catch (error) {
            console.error('Get map center error:', error);
            return failure(error, 'Failed to fetch map center');
        }
    },

    getPublicLandingPageSettings: async () => {
        try {
            const response = await apiClient.get(
                '/api/settings/landing-page',
                getRequestPolicyConfig(REQUEST_POLICY.SILENT_PUBLIC)
            );
            return response.data;
        } catch (error) {
            console.error('Get landing page settings error:', error);
            return failure(error, 'Failed to fetch landing page settings');
        }
    },

    getPublicAdsSettings: async () => {
        try {
            const response = await apiClient.get(
                '/api/settings/public-ads',
                getRequestPolicyConfig(REQUEST_POLICY.SILENT_PUBLIC)
            );
            return response.data;
        } catch (error) {
            console.error('Get public ads settings error:', error);
            return failure(error, 'Failed to fetch ads settings');
        }
    },

    // Admin - get all settings
    getAllSettings: async () => {
        try {
            const response = await apiClient.get('/api/settings');
            return response.data;
        } catch (error) {
            console.error('Get all settings error:', error);
            return failure(error, 'Failed to fetch settings');
        }
    },

    // Admin - update setting
    updateSetting: async (key, value, description) => {
        try {
            const response = await apiClient.put(`/api/settings/${key}`, { value, description });
            return response.data;
        } catch (error) {
            console.error('Update setting error:', error);
            return failure(error, 'Failed to update setting');
        }
    },

    // Admin - update map center
    updateMapCenter: async (latitude, longitude, zoom, name) => {
        try {
            const response = await apiClient.put('/api/settings/map_default_center', {
                value: { latitude, longitude, zoom, name }
            });
            return response.data;
        } catch (error) {
            console.error('Update map center error:', error);
            return failure(error, 'Failed to update map center');
        }
    },
};
