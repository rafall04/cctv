import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

/**
 * Feedback API client.
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

export const feedbackService = {
    // Public - submit feedback
    async submit(data) {
        try {
            const response = await apiClient.post('/api/feedback', data);
            return response.data;
        } catch (error) {
            console.error('Submit feedback error:', error);
            return failure(error, 'Gagal mengirim feedback');
        }
    },

    // Admin - get all feedbacks
    async getAll(params = {}, policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get('/api/feedback', {
                ...getRequestPolicyConfig(policy, config),
                params,
            });
            return response.data;
        } catch (error) {
            console.error('Get feedbacks error:', error);
            return failure(error, 'Gagal memuat feedback');
        }
    },

    // Admin - get stats
    async getStats(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get('/api/feedback/stats', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get feedback stats error:', error);
            return failure(error, 'Gagal memuat statistik feedback');
        }
    },

    // Admin - update status
    async updateStatus(id, status) {
        try {
            const response = await apiClient.patch(`/api/feedback/${id}/status`, { status });
            return response.data;
        } catch (error) {
            console.error('Update feedback status error:', error);
            return failure(error, 'Gagal mengubah status feedback');
        }
    },

    // Admin - delete
    async delete(id) {
        try {
            const response = await apiClient.delete(`/api/feedback/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete feedback error:', error);
            return failure(error, 'Gagal menghapus feedback');
        }
    },
};

export default feedbackService;
