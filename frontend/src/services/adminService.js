import apiClient from './apiClient';

export const adminService = {
    async getStats() {
        try {
            const response = await apiClient.get('/api/admin/stats');
            return response.data;
        } catch (error) {
            console.error('Get stats error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch statistics'
            };
        }
    },

    async getTodayStats(period = 'today') {
        try {
            const response = await apiClient.get(`/api/admin/stats/today?period=${period}`);
            return response.data;
        } catch (error) {
            console.error('Get today stats error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch today statistics'
            };
        }
    },

    async getViewerAnalytics(period = '7days') {
        try {
            const response = await apiClient.get(`/api/admin/analytics/viewers?period=${period}`);
            return response.data;
        } catch (error) {
            console.error('Get viewer analytics error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch analytics'
            };
        }
    },

    async getRealTimeViewers() {
        try {
            const response = await apiClient.get('/api/admin/analytics/realtime');
            return response.data;
        } catch (error) {
            console.error('Get real-time viewers error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch real-time data'
            };
        }
    },

    async getTelegramStatus() {
        try {
            const response = await apiClient.get('/api/admin/telegram/status');
            return response.data;
        } catch (error) {
            console.error('Get Telegram status error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch Telegram status'
            };
        }
    },

    async updateTelegramConfig(config) {
        try {
            const response = await apiClient.put('/api/admin/telegram/config', config);
            return response.data;
        } catch (error) {
            console.error('Update Telegram config error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to update Telegram config'
            };
        }
    },

    async testTelegramNotification(type = 'monitoring') {
        try {
            const response = await apiClient.post('/api/admin/telegram/test', { type });
            return response.data;
        } catch (error) {
            console.error('Test Telegram notification error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to send test notification'
            };
        }
    }
};
