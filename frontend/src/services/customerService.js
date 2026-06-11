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

    async createTopup(amount) {
        const response = await apiClient.post('/api/customer/topup', { amount });
        return response.data;
    },

    async getTopupStatus(paymentId) {
        const response = await apiClient.get(`/api/customer/topup/${paymentId}`);
        return response.data;
    },
};

export default customerService;
