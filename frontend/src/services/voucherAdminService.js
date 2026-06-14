/*
 * Purpose: Admin API client for the voucher area-access feature — global flag, per-area gating,
 *          voucher-profile CRUD, and code generation/listing/revocation.
 * Caller: pages/VoucherManagement.jsx (admin).
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: getSettings/updateSettings, setAreaGated, profile CRUD, generateCodes/getCodes/revokeCode.
 * SideEffects: HTTP requests only.
 */

import apiClient from './apiClient';

export const voucherAdminService = {
    async getSettings() {
        const response = await apiClient.get('/api/admin/voucher/settings');
        return response.data;
    },

    async updateSettings(enabled) {
        const response = await apiClient.put('/api/admin/voucher/settings', { enabled });
        return response.data;
    },

    async setAreaGated(areaId, gated) {
        const response = await apiClient.put(`/api/admin/voucher/areas/${areaId}/gate`, { gated });
        return response.data;
    },

    async getProfiles() {
        const response = await apiClient.get('/api/admin/voucher/profiles');
        return response.data;
    },

    async createProfile(payload) {
        const response = await apiClient.post('/api/admin/voucher/profiles', payload);
        return response.data;
    },

    async updateProfile(id, payload) {
        const response = await apiClient.put(`/api/admin/voucher/profiles/${id}`, payload);
        return response.data;
    },

    async deleteProfile(id) {
        const response = await apiClient.delete(`/api/admin/voucher/profiles/${id}`);
        return response.data;
    },

    async generateCodes(profileId, payload) {
        const response = await apiClient.post(`/api/admin/voucher/profiles/${profileId}/codes`, payload);
        return response.data;
    },

    async getCodes(params = {}) {
        const response = await apiClient.get('/api/admin/voucher/codes', { params });
        return response.data;
    },

    async revokeCode(id) {
        const response = await apiClient.post(`/api/admin/voucher/codes/${id}/revoke`);
        return response.data;
    },
};

export default voucherAdminService;
