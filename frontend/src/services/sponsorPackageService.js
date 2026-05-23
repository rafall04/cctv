/*
Purpose: Admin frontend client for the sponsor package catalog.
Caller: SponsorPackagePanel, sponsor modal dropdown.
Deps: apiClient.
MainFuncs: listPackages, createPackage, updatePackage, deletePackage.
SideEffects: Sends admin sponsor package requests to /api/sponsor-packages.

All methods follow the shared catch-and-return contract — they never
throw, they return `{ success: false, message }` on error.
*/

import apiClient from './apiClient';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

export const sponsorPackageService = {
    async listPackages() {
        try {
            const response = await apiClient.get('/api/sponsor-packages');
            return response.data;
        } catch (error) {
            console.error('List sponsor packages error:', error);
            return failure(error, 'Gagal memuat profil paket');
        }
    },

    async createPackage(payload) {
        try {
            const response = await apiClient.post('/api/sponsor-packages', payload);
            return response.data;
        } catch (error) {
            console.error('Create sponsor package error:', error);
            return failure(error, 'Gagal menambah profil paket');
        }
    },

    async updatePackage(id, payload) {
        try {
            const response = await apiClient.put(`/api/sponsor-packages/${id}`, payload);
            return response.data;
        } catch (error) {
            console.error('Update sponsor package error:', error);
            return failure(error, 'Gagal memperbarui profil paket');
        }
    },

    async deletePackage(id) {
        try {
            const response = await apiClient.delete(`/api/sponsor-packages/${id}`);
            return response.data;
        } catch (error) {
            console.error('Delete sponsor package error:', error);
            return failure(error, 'Gagal menghapus profil paket');
        }
    },
};

export default sponsorPackageService;
