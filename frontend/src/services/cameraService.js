import apiClient from './apiClient';

export const cameraService = {
    // Get all active cameras (public)
    async getActiveCameras() {
        try {
            const response = await apiClient.get('/api/cameras/active');
            return response.data;
        } catch (error) {
            console.error('Get active cameras error:', error);
            throw error;
        }
    },

    // Get all cameras (admin only)
    async getAllCameras() {
        try {
            const response = await apiClient.get('/api/cameras');
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
};

export default cameraService;
