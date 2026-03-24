import apiClient from './apiClient';
import { getRequestPolicyConfig, REQUEST_POLICY } from './requestPolicy';

export const cameraService = {
    // Get all active cameras (public)
    async getActiveCameras(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get('/api/cameras/active', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get active cameras error:', error);
            throw error;
        }
    },

    // Get all cameras (admin only)
    async getAllCameras(policy = REQUEST_POLICY.BLOCKING, config = {}) {
        try {
            const response = await apiClient.get('/api/cameras', getRequestPolicyConfig(policy, config));
            return response.data;
        } catch (error) {
            console.error('Get all cameras error:', error);
            throw error;
        }
    },

    // Get camera by ID (admin only)
    async getCameraById(id) {
        try {
            const response = await apiClient.get(`/api/cameras/${id}`);
            return response.data;
        } catch (error) {
            console.error('Get camera by ID error:', error);
            throw error;
        }
    },

    // Create camera (admin only)
    async createCamera(cameraData) {
        try {
            const response = await apiClient.post('/api/cameras', cameraData);
            return response.data;
        } catch (error) {
            console.error('Create camera error:', error);
            throw error;
        }
    },

    // Update camera (admin only)
    async updateCamera(id, cameraData) {
        try {
            const response = await apiClient.put(`/api/cameras/${id}`, cameraData);
            return response.data;
        } catch (error) {
            console.error('Update camera error:', error);
            throw error;
        }
    },

    // Delete camera (admin only)
    async deleteCamera(id) {
        try {
            const response = await apiClient.delete(`/api/cameras/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete camera error:', error);
            throw error;
        }
    },

    // Export cameras (admin only)
    async exportCameras() {
        try {
            const response = await apiClient.get('/api/cameras/export');
            return response.data;
        } catch (error) {
            console.error('Export cameras error:', error);
            throw error;
        }
    },

    // Import cameras (admin only)
    async importCameras(payload) {
        try {
            const response = await apiClient.post('/api/cameras/import', payload);
            return response.data;
        } catch (error) {
            console.error('Import cameras error:', error);
            throw error;
        }
    },

    // Bulk update area (admin only)
    async bulkUpdateByArea(areaId, updates) {
        try {
            const response = await apiClient.patch('/api/cameras/bulk/area', { areaId, updates });
            return response.data;
        } catch (error) {
            console.error('Bulk update area error:', error);
            throw error;
        }
    },

    // Bulk delete area cameras (admin only)
    async bulkDeleteByArea(areaId) {
        try {
            const response = await apiClient.delete(`/api/cameras/bulk/area/${areaId}`);
            return response.data;
        } catch (error) {
            console.error('Bulk delete area cameras error:', error);
            throw error;
        }
    },
};

export default cameraService;
