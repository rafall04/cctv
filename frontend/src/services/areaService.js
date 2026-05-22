import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

/**
 * Area API client.
 *
 * Contract: every method resolves to a plain result object and never throws —
 * on a network/HTTP error it returns `{ success: false, message }`. Callers
 * branch on `result.success`. This matches cameraService/userService so the
 * whole frontend has one error contract.
 */

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

export const areaService = {
    // Public - get all areas (no auth required)
    getPublicAreas: async (policy = REQUEST_POLICY.SILENT_PUBLIC, config = {}) => {
        try {
            const response = await apiClient.get('/api/areas/public', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get public areas error:', error);
            return failure(error, 'Failed to fetch areas');
        }
    },

    getAllAreas: async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
        try {
            const response = await apiClient.get('/api/areas', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get all areas error:', error);
            return failure(error, 'Failed to fetch areas');
        }
    },

    getAdminOverview: async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
        try {
            const response = await apiClient.get('/api/areas/overview', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get area overview error:', error);
            return failure(error, 'Failed to fetch area overview');
        }
    },

    getAreaSummary: async () => {
        try {
            const response = await apiClient.get('/api/areas/summary');
            return response.data;
        } catch (error) {
            console.error('Get area summary error:', error);
            return failure(error, 'Failed to fetch area summary');
        }
    },

    getAreaById: async (id) => {
        try {
            const response = await apiClient.get(`/api/areas/${id}`);
            return response.data;
        } catch (error) {
            console.error('Get area by id error:', error);
            return failure(error, 'Failed to fetch area');
        }
    },

    createArea: async (areaData) => {
        try {
            const response = await apiClient.post('/api/areas', areaData);
            return response.data;
        } catch (error) {
            console.error('Create area error:', error);
            return failure(error, 'Failed to create area');
        }
    },

    updateArea: async (id, areaData) => {
        try {
            const response = await apiClient.put(`/api/areas/${id}`, areaData);
            return response.data;
        } catch (error) {
            console.error('Update area error:', error);
            return failure(error, 'Failed to update area');
        }
    },

    deleteArea: async (id) => {
        try {
            const response = await apiClient.delete(`/api/areas/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete area error:', error);
            return failure(error, 'Failed to delete area');
        }
    },
};
