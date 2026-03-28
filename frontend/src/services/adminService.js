import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

export const adminService = {
    async getStats(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get('/api/admin/stats', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get stats error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch statistics'
            };
        }
    },

    async getTodayStats(period = 'today', policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get(
                `/api/admin/stats/today?period=${period}`,
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get today stats error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch today statistics'
            };
        }
    },

    async getViewerAnalytics(period = '7days', policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get(
                `/api/admin/analytics/viewers?period=${period}`,
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get viewer analytics error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch analytics'
            };
        }
    },

    async getRealTimeViewers(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get(
                '/api/admin/analytics/realtime',
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get real-time viewers error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch real-time data'
            };
        }
    },

    async getPlaybackViewerAnalytics(period = '7days', params = {}, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const searchParams = new URLSearchParams();
            searchParams.set('period', period);

            if (params.cameraId) {
                searchParams.set('cameraId', String(params.cameraId));
            }

            if (params.accessMode) {
                searchParams.set('accessMode', params.accessMode);
            }

            const response = await apiClient.get(
                `/api/playback-viewer/analytics?${searchParams.toString()}`,
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get playback viewer analytics error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch playback analytics',
            };
        }
    },

    async getPlaybackViewerActive(params = {}, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const searchParams = new URLSearchParams();
            if (params.cameraId) {
                searchParams.set('cameraId', String(params.cameraId));
            }
            if (params.accessMode) {
                searchParams.set('accessMode', params.accessMode);
            }

            const response = await apiClient.get(
                `/api/playback-viewer/active${searchParams.toString() ? `?${searchParams.toString()}` : ''}`,
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get active playback viewers error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch active playback viewers',
            };
        }
    },

    async getCameraHealthDebug(params = {}, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const searchParams = new URLSearchParams();
            Object.entries(params || {}).forEach(([key, value]) => {
                if (value !== undefined && value !== null && value !== '') {
                    searchParams.set(key, String(value));
                }
            });

            const queryString = searchParams.toString();
            const response = await apiClient.get(
                `/api/admin/debug/camera-health${queryString ? `?${queryString}` : ''}`,
                getRequestPolicyConfig(policy, config)
            );
            return response.data;
        } catch (error) {
            console.error('Get camera health debug error:', error);
            return {
                success: false,
                message: error.response?.data?.message || 'Failed to fetch camera health debug'
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
