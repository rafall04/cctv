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
    }
};
