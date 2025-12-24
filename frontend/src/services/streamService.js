import apiClient from './apiClient';

export const streamService = {
    // Get all active streams (public)
    async getAllActiveStreams() {
        try {
            const response = await apiClient.get('/api/stream');
            return response.data;
        } catch (error) {
            console.error('Get all active streams error:', error);
            throw error;
        }
    },

    // Get stream URLs for specific camera (public)
    async getStreamUrls(cameraId) {
        try {
            const response = await apiClient.get(`/api/stream/${cameraId}`);
            return response.data;
        } catch (error) {
            console.error('Get stream URLs error:', error);
            throw error;
        }
    },
};

export default streamService;
