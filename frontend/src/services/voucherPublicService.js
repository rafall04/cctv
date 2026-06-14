/*
 * Purpose: Public API client for the voucher area-access feature — gate state, code redemption, and
 *          self-serve payment (create order + poll status). Used by the public landing/locked-camera
 *          UI and the claim/redeem pages.
 * Caller: public locked-camera overlay, /buka redeem form, claim/poll page.
 * Deps: shared apiClient (sends the signed vdev cookie automatically, same-origin).
 * MainFuncs: getAccess, redeem, createOrder, getOrderStatus.
 * SideEffects: HTTP requests only; redeem/createOrder set the httpOnly vdev cookie server-side.
 */

import apiClient from './apiClient';

export const voucherPublicService = {
    // { enabled, gated_area_ids, accessible_area_ids } — frontend renders a lock when a camera's
    // area is gated but not accessible.
    async getAccess() {
        const response = await apiClient.get('/api/voucher/access');
        return response.data;
    },

    // Redeem an existing code (admin-generated or self-issued) on this device → unlock + set cookie.
    async redeem({ code, name = null, phone = null }) {
        const response = await apiClient.post('/api/voucher/redeem', { code, name, phone });
        return response.data;
    },

    // Self-serve: open an iPaymu QRIS order for a profile (sets the device cookie up-front).
    async createOrder({ profileId, name = null, phone = null, methodKey = null }) {
        const response = await apiClient.post('/api/voucher/order', { profileId, name, phone, methodKey });
        return response.data;
    },

    // Claim-page poll: returns the order (with the issued voucher once status === 'paid').
    async getOrderStatus(orderId) {
        const response = await apiClient.get(`/api/voucher/order/${orderId}/status`);
        return response.data;
    },
};

export default voucherPublicService;
