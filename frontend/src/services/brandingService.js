import apiClient from './apiClient';

/**
 * Branding Service
 * Handles branding/white-label settings
 */

export const brandingService = {
    /**
     * Get public branding settings (no auth required)
     * @returns {Promise<Object>} Branding settings object
     */
    async getPublicBranding() {
        try {
            const response = await apiClient.get('/api/branding/public');
            return response.data.success ? response.data.data : null;
        } catch (error) {
            console.error('Get public branding error:', error);
            return null;
        }
    },

    /**
     * Get admin branding settings with metadata (auth required)
     * @returns {Promise<Array>} Branding settings array
     */
    async getAdminBranding() {
        try {
            const response = await apiClient.get('/api/branding/admin');
            return response.data;
        } catch (error) {
            console.error('Get admin branding error:', error);
            throw error;
        }
    },

    /**
     * Update single branding setting (auth required)
     * @param {string} key - Setting key
     * @param {string} value - Setting value
     * @returns {Promise<Object>} Response
     */
    async updateSetting(key, value) {
        try {
            const response = await apiClient.put(`/api/branding/${key}`, { value });
            return response.data;
        } catch (error) {
            console.error('Update branding setting error:', error);
            throw error;
        }
    },

    /**
     * Bulk update branding settings (auth required)
     * @param {Object} settings - Settings object { key: value }
     * @returns {Promise<Object>} Response
     */
    async bulkUpdate(settings) {
        try {
            const response = await apiClient.post('/api/branding/bulk', { settings });
            return response.data;
        } catch (error) {
            console.error('Bulk update branding error:', error);
            throw error;
        }
    },

    /**
     * Reset branding to defaults (auth required)
     * @returns {Promise<Object>} Response
     */
    async resetToDefaults() {
        try {
            const response = await apiClient.post('/api/branding/reset');
            return response.data;
        } catch (error) {
            console.error('Reset branding error:', error);
            throw error;
        }
    },
};

export default brandingService;
