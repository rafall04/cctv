import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

export const feedbackService = {
    // Public - submit feedback
    async submit(data) {
        const response = await apiClient.post('/api/feedback', data);
        return response.data;
    },

    // Admin - get all feedbacks
    async getAll(params = {}, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        const response = await apiClient.get('/api/feedback', {
            ...getRequestPolicyConfig(policy, config),
            params,
        });
        return response.data;
    },

    // Admin - get stats
    async getStats(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        const response = await apiClient.get('/api/feedback/stats', getRequestPolicyConfig(policy, config));
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
