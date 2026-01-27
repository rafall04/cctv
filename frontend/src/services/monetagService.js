import apiClient from './apiClient';

/**
 * Get Monetag settings (Admin only)
 */
export async function getMonetagSettings() {
    const response = await apiClient.get('/api/monetag/settings');
    return response.data;
}

/**
 * Update Monetag settings (Admin only)
 */
export async function updateMonetagSettings(settings) {
    const response = await apiClient.put('/api/monetag/settings', settings);
    return response.data;
}

/**
 * Get public Monetag config (Public endpoint)
 * Returns only enabled settings with valid zone IDs
 */
export async function getPublicMonetagConfig() {
    const response = await apiClient.get('/api/monetag/config');
    return response.data;
}

export const monetagService = {
    getMonetagSettings,
    updateMonetagSettings,
    getPublicMonetagConfig
};

export default monetagService;
