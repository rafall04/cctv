import apiClient from './apiClient';

export const feedbackService = {
    // Public - submit feedback
    async submit(data) {
        const response = await apiClient.post('/api/feedback', data);
        return response.data;
    },

    // Admin - get all feedbacks
    async getAll(params = {}, config = {}) {
        const response = await apiClient.get('/api/feedback', { ...config, params });
        return response.data;
    },

    // Admin - get stats
    async getStats(config = {}) {
        const response = await apiClient.get('/api/feedback/stats', config);
        return response.data;
    },

    // Admin - update status
    async updateStatus(id, status) {
        const response = await apiClient.patch(`/api/feedback/${id}/status`, { status });
        return response.data;
    },

    // Admin - delete
    async delete(id) {
        const response = await apiClient.delete(`/api/feedback/${id}`);
        return response.data;
    },
};

export default feedbackService;
