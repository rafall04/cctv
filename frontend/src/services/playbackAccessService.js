/*
 * Purpose: Public API client for buying playback access — package catalogue, free trial claim, and
 *          self-serve iPaymu payment (create order + poll status).
 * Caller: components/playback/PlaybackAccessPanel.
 * Deps: shared apiClient (sends the signed vdev device cookie automatically, same-origin).
 * MainFuncs: getProducts, claimTrial, createOrder, getOrderStatus, renewOrder, recoverTokens.
 * SideEffects: HTTP requests only; the device cookie is set server-side on first call.
 */

import apiClient from './apiClient';

export const playbackAccessService = {
    // { products: [...], trial: { available, claimed, ... } } — trial state is per device.
    async getProducts() {
        const response = await apiClient.get('/api/playback-access/products');
        return response.data;
    },

    // One free trial per device; 409 when this device already used it.
    async claimTrial() {
        const response = await apiClient.post('/api/playback-access/trial', {});
        return response.data;
    },

    async createOrder({ productKey, name = null, phone = null, methodKey = null }) {
        const response = await apiClient.post('/api/playback-access/order', { productKey, name, phone, methodKey });
        return response.data;
    },

    // Poll target: returns `access` (the share key) once status === 'paid'. Visible only to the
    // device that opened the order, so this is safe to call from a public page.
    async getOrderStatus(orderId) {
        const response = await apiClient.get(`/api/playback-access/order/${orderId}`);
        return response.data;
    },

    // Renew (perpanjang) an existing token: same token, extended validity. Poll the returned order
    // exactly like a purchase; on 'paid' the buyer's SAME access code keeps working, just longer.
    async renewOrder({ accessCode, productKey, name = null, phone = null, methodKey = null }) {
        const response = await apiClient.post('/api/playback-access/renew', { accessCode, productKey, name, phone, methodKey });
        return response.data;
    },

    // Recover active tokens by phone + recovery code (shown at purchase). No messaging needed.
    async recoverTokens({ phone, code }) {
        const response = await apiClient.post('/api/playback-access/recover', { phone, code });
        return response.data;
    },
};

export default playbackAccessService;
