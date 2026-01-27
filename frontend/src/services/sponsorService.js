/**
 * Sponsor Service
 * API calls untuk sponsor management
 */

import apiClient from './apiClient';

/**
 * Get all sponsors (admin)
 */
export const getAllSponsors = async () => {
    const response = await apiClient.get('/api/sponsors');
    return response.data;
};

/**
 * Get active sponsors (public)
 */
export const getActiveSponsors = async () => {
    const response = await apiClient.get('/api/sponsors/active');
    return response.data;
};

/**
 * Get sponsor by ID
 */
export const getSponsorById = async (id) => {
    const response = await apiClient.get(`/api/sponsors/${id}`);
    return response.data;
};

/**
 * Create new sponsor
 */
export const createSponsor = async (sponsorData) => {
    const response = await apiClient.post('/api/sponsors', sponsorData);
    return response.data;
};

/**
 * Update sponsor
 */
export const updateSponsor = async (id, sponsorData) => {
    const response = await apiClient.put(`/api/sponsors/${id}`, sponsorData);
    return response.data;
};

/**
 * Delete sponsor
 */
export const deleteSponsor = async (id) => {
    const response = await apiClient.delete(`/api/sponsors/${id}`);
    return response.data;
};

/**
 * Get sponsor statistics
 */
export const getSponsorStats = async () => {
    const response = await apiClient.get('/api/sponsors/stats');
    return response.data;
};

/**
 * Assign sponsor to camera
 */
export const assignSponsorToCamera = async (cameraId, sponsorData) => {
    const response = await apiClient.post(`/api/sponsors/camera/${cameraId}/assign`, sponsorData);
    return response.data;
};

/**
 * Remove sponsor from camera
 */
export const removeSponsorFromCamera = async (cameraId) => {
    const response = await apiClient.delete(`/api/sponsors/camera/${cameraId}/remove`);
    return response.data;
};

/**
 * Get cameras with sponsors
 */
export const getCamerasWithSponsors = async () => {
    const response = await apiClient.get('/api/sponsors/cameras');
    return response.data;
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
