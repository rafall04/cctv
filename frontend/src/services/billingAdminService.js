/*
 * Purpose: Admin billing API client — customers, subscriptions, payments, manual top-up.
 * Caller: pages/BillingManagement.jsx.
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: customers/subscriptions/payments CRUD-ish helpers.
 * SideEffects: HTTP requests only.
 */

import apiClient from './apiClient';

export const billingAdminService = {
    async getCustomers() {
        const response = await apiClient.get('/api/admin/billing/customers');
        return response.data;
    },

    async manualTopup({ user_id, amount, note }) {
        const response = await apiClient.post('/api/admin/billing/topup-manual', { user_id, amount, note });
        return response.data;
    },

    async getSubscriptions() {
        const response = await apiClient.get('/api/admin/billing/subscriptions');
        return response.data;
    },

    async assignSubscription({ camera_id, user_id, monthly_price }) {
        const response = await apiClient.post('/api/admin/billing/subscriptions', { camera_id, user_id, monthly_price });
        return response.data;
    },

    async updateSubscription(id, payload) {
        const response = await apiClient.put(`/api/admin/billing/subscriptions/${id}`, payload);
        return response.data;
    },

    async setCameraClass(cameraId, payload) {
        const response = await apiClient.put(`/api/admin/billing/cameras/${cameraId}/class`, payload);
        return response.data;
    },

    async getPayments(limit = 100) {
        const response = await apiClient.get('/api/admin/billing/payments', { params: { limit } });
        return response.data;
    },

    async markPaymentPaid(id) {
        const response = await apiClient.post(`/api/admin/billing/payments/${id}/mark-paid`);
        return response.data;
    },

    async runCharges() {
        const response = await apiClient.post('/api/admin/billing/charges/run');
        return response.data;
    },
};

export default billingAdminService;
