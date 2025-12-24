import apiClient from './apiClient';

export const areaService = {
    getAllAreas: async () => {
        const response = await apiClient.get('/api/areas');
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
