import apiClient from './apiClient';

/**
 * Get Saweria settings (Admin only)
 */
export async function getSaweriaSettings() {
    const response = await apiClient.get('/api/saweria/settings');
    return response.data;
}

/**
 * Update Saweria settings (Admin only)
 */
export async function updateSaweriaSettings(settings) {
    const response = await apiClient.put('/api/saweria/settings', settings);
    return response.data;
}

/**
 * Get public Saweria config (Public endpoint)
 * Returns only enabled settings
 */
export async function getPublicSaweriaConfig() {
    const response = await apiClient.get('/api/saweria/config');
    return response.data;
}

export const saweriaService = {
    getSaweriaSettings,
    updateSaweriaSettings,
    getPublicSaweriaConfig
};

export default saweriaService;
