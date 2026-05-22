/**
 * Sponsor Service
 * API calls untuk sponsor management.
 *
 * Contract: methods never throw — on error they return
 * `{ success: false, message }`. Callers branch on `result.success`.
 */

import apiClient from './apiClient';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

/**
 * Get all sponsors (admin)
 */
export const getAllSponsors = async () => {
    try {
        const response = await apiClient.get('/api/sponsors');
        return response.data;
    } catch (error) {
        console.error('Get all sponsors error:', error);
        return failure(error, 'Gagal memuat sponsor');
    }
};

/**
 * Get active sponsors (public)
 */
export const getActiveSponsors = async () => {
    try {
        const response = await apiClient.get('/api/sponsors/active');
        return response.data;
    } catch (error) {
        console.error('Get active sponsors error:', error);
        return failure(error, 'Gagal memuat sponsor aktif');
    }
};

/**
 * Get sponsor by ID
 */
export const getSponsorById = async (id) => {
    try {
        const response = await apiClient.get(`/api/sponsors/${id}`);
        return response.data;
    } catch (error) {
        console.error('Get sponsor by id error:', error);
        return failure(error, 'Gagal memuat sponsor');
    }
};

/**
 * Create new sponsor
 */
export const createSponsor = async (sponsorData) => {
    try {
        const response = await apiClient.post('/api/sponsors', sponsorData);
        return response.data;
    } catch (error) {
        console.error('Create sponsor error:', error);
        return failure(error, 'Gagal membuat sponsor');
    }
};

/**
 * Update sponsor
 */
export const updateSponsor = async (id, sponsorData) => {
    try {
        const response = await apiClient.put(`/api/sponsors/${id}`, sponsorData);
        return response.data;
    } catch (error) {
        console.error('Update sponsor error:', error);
        return failure(error, 'Gagal memperbarui sponsor');
    }
};

/**
 * Delete sponsor
 */
export const deleteSponsor = async (id) => {
    try {
        const response = await apiClient.delete(`/api/sponsors/${id}`);
        return response.data;
    } catch (error) {
        console.error('Delete sponsor error:', error);
        return failure(error, 'Gagal menghapus sponsor');
    }
};

/**
 * Get sponsor statistics
 */
export const getSponsorStats = async () => {
    try {
        const response = await apiClient.get('/api/sponsors/stats');
        return response.data;
    } catch (error) {
        console.error('Get sponsor stats error:', error);
        return failure(error, 'Gagal memuat statistik sponsor');
    }
};

/**
 * Assign sponsor to camera
 */
export const assignSponsorToCamera = async (cameraId, sponsorData) => {
    try {
        const response = await apiClient.post(`/api/sponsors/camera/${cameraId}/assign`, sponsorData);
        return response.data;
    } catch (error) {
        console.error('Assign sponsor error:', error);
        return failure(error, 'Gagal menautkan sponsor ke kamera');
    }
};

/**
 * Remove sponsor from camera
 */
export const removeSponsorFromCamera = async (cameraId) => {
    try {
        const response = await apiClient.delete(`/api/sponsors/camera/${cameraId}/remove`);
        return response.data;
    } catch (error) {
        console.error('Remove sponsor error:', error);
        return failure(error, 'Gagal melepas sponsor dari kamera');
    }
};

/**
 * Get cameras with sponsors
 */
export const getCamerasWithSponsors = async () => {
    try {
        const response = await apiClient.get('/api/sponsors/cameras');
        return response.data;
    } catch (error) {
        console.error('Get cameras with sponsors error:', error);
        return failure(error, 'Gagal memuat kamera bersponsor');
    }
};

export default {
    getAllSponsors,
    getActiveSponsors,
    getSponsorById,
    createSponsor,
    updateSponsor,
    deleteSponsor,
    getSponsorStats,
    assignSponsorToCamera,
    removeSponsorFromCamera,
    getCamerasWithSponsors
};
