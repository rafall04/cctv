import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

export const areaService = {
    // Public - get all areas (no auth required)
    getPublicAreas: async (policy = REQUEST_POLICY.SILENT_PUBLIC, config = {}) => {
        const response = await apiClient.get('/api/areas/public', getRequestPolicyConfig(policy, config));
        return response.data;
    },
    
    getAllAreas: async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
        const response = await apiClient.get('/api/areas', getRequestPolicyConfig(policy, config));
        return response.data;
    },
    getAdminOverview: async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
        const response = await apiClient.get('/api/areas/overview', getRequestPolicyConfig(policy, config));
        return response.data;
    },
    getAreaSummary: async () => {
        const response = await apiClient.get('/api/areas/summary');
        return response.data;
    },
    getAreaById: async (id) => {
        const response = await apiClient.get(`/api/areas/${id}`);
        return response.data;
    },
    createArea: async (areaData) => {
        const response = await apiClient.post('/api/areas', areaData);
        return response.data;
    },
    updateArea: async (id, areaData) => {
        const response = await apiClient.put(`/api/areas/${id}`, areaData);
        return response.data;
    },
    deleteArea: async (id) => {
        const response = await apiClient.delete(`/api/areas/${id}`);
        return response.data;
    },
};
