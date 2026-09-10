/*
 * Purpose: Admin API client for the voucher area-access feature — global flag, per-area gating,
 *          voucher-profile CRUD, and code generation/listing/revocation.
 * Caller: pages/VoucherManagement.jsx (admin).
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: getSettings/updateSettings, setAreaGated, profile CRUD, generateCodes/getCodes/revokeCode.
 * SideEffects: HTTP requests only.
 *
 * Contract: methods NEVER throw — on any error (offline / 500 / non-2xx) they resolve to
 * `{ success: false, message }`, so a caller's `if (res.success)` branch and its loading/busy flags are
 * never skipped by a thrown rejection (which used to hang the page skeleton + action spinners).
 */

import apiClient from './apiClient';

function fail(error, fallback) {
    return { success: false, message: error?.response?.data?.message || error?.message || fallback };
}

export const voucherAdminService = {
    async getSettings() {
        try { return (await apiClient.get('/api/admin/voucher/settings')).data; }
        catch (e) { return fail(e, 'Gagal memuat pengaturan voucher'); }
    },

    async updateSettings(enabled) {
        try { return (await apiClient.put('/api/admin/voucher/settings', { enabled })).data; }
        catch (e) { return fail(e, 'Gagal menyimpan pengaturan voucher'); }
    },

    async setAreaGated(areaId, gated) {
        try { return (await apiClient.put(`/api/admin/voucher/areas/${areaId}/gate`, { gated })).data; }
        catch (e) { return fail(e, 'Gagal mengubah gerbang area'); }
    },

    async getProfiles() {
        try { return (await apiClient.get('/api/admin/voucher/profiles')).data; }
        catch (e) { return fail(e, 'Gagal memuat profil voucher'); }
    },

    async createProfile(payload) {
        try { return (await apiClient.post('/api/admin/voucher/profiles', payload)).data; }
        catch (e) { return fail(e, 'Gagal membuat profil'); }
    },

    async updateProfile(id, payload) {
        try { return (await apiClient.put(`/api/admin/voucher/profiles/${id}`, payload)).data; }
        catch (e) { return fail(e, 'Gagal memperbarui profil'); }
    },

    async deleteProfile(id) {
        try { return (await apiClient.delete(`/api/admin/voucher/profiles/${id}`)).data; }
        catch (e) { return fail(e, 'Gagal menghapus profil'); }
    },

    async generateCodes(profileId, payload) {
        try { return (await apiClient.post(`/api/admin/voucher/profiles/${profileId}/codes`, payload)).data; }
        catch (e) { return fail(e, 'Gagal membuat kode'); }
    },

    async getCodes(params = {}) {
        try { return (await apiClient.get('/api/admin/voucher/codes', { params })).data; }
        catch (e) { return fail(e, 'Gagal memuat kode'); }
    },

    async revokeCode(id) {
        try { return (await apiClient.post(`/api/admin/voucher/codes/${id}/revoke`)).data; }
        catch (e) { return fail(e, 'Gagal mencabut kode'); }
    },
};

export default voucherAdminService;
