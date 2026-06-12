/*
 * Purpose: Customer-portal API client — own cameras, billing summary, wallet ledger, top-ups.
 * Caller: pages/customer/* and CustomerLayout.
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: getMyCameras, getSummary, getWallet, getPayments, createTopup, getTopupStatus.
 * SideEffects: HTTP requests only.
 */

import apiClient from './apiClient';

export const customerService = {
    async getMyCameras() {
        const response = await apiClient.get('/api/customer/cameras');
        return response.data;
    },

    async getSummary() {
        const response = await apiClient.get('/api/customer/summary');
        return response.data;
    },

    async getWallet(limit = 50) {
        const response = await apiClient.get('/api/customer/wallet', { params: { limit } });
        return response.data;
    },

    async getPayments(limit = 20) {
        const response = await apiClient.get('/api/customer/payments', { params: { limit } });
        return response.data;
    },

    async getPaymentOptions() {
        const response = await apiClient.get('/api/customer/payment-options');
        return response.data;
    },

    async createTopup(amount, method = null, promo = null) {
        const body = { amount };
        if (method) body.method = method;
        if (promo) body.promo = promo;
        const response = await apiClient.post('/api/customer/topup', body);
        return response.data;
    },

    async validatePromo(code, amount) {
        const response = await apiClient.get('/api/customer/promo/validate', { params: { code, amount } });
        return response.data;
    },

    async redeemPromo(code) {
        const response = await apiClient.post('/api/customer/promo/redeem', { code });
        return response.data;
    },

    async getTopupStatus(paymentId) {
        const response = await apiClient.get(`/api/customer/topup/${paymentId}`);
        return response.data;
    },

    async getPlan() {
        const response = await apiClient.get('/api/customer/plan');
        return response.data;
    },

    async getPlans() {
        const response = await apiClient.get('/api/customer/plans');
        return response.data;
    },

    async switchPlan(planKey) {
        const response = await apiClient.post('/api/customer/plan', { plan_key: planKey });
        return response.data;
    },

    async createCamera(payload) {
        const response = await apiClient.post('/api/customer/cameras', payload);
        return response.data;
    },

    async updateCamera(id, payload) {
        const response = await apiClient.put(`/api/customer/cameras/${id}`, payload);
        return response.data;
    },

    async deleteCamera(id) {
        const response = await apiClient.delete(`/api/customer/cameras/${id}`);
        return response.data;
    },

    // Read-only list of admin-curated public areas, for the camera area picker.
    async getAreas() {
        const response = await apiClient.get('/api/customer/areas');
        return response.data;
    },
};

export default customerService;
