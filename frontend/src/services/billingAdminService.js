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

    async getPlans() {
        const response = await apiClient.get('/api/admin/billing/plans');
        return response.data;
    },

    async createPlan(payload) {
        const response = await apiClient.post('/api/admin/billing/plans', payload);
        return response.data;
    },

    async updatePlan(id, payload) {
        const response = await apiClient.put(`/api/admin/billing/plans/${id}`, payload);
        return response.data;
    },

    async changeCustomerPlan(customerId, planKey) {
        const response = await apiClient.put(`/api/admin/billing/customers/${customerId}/plan`, { plan_key: planKey });
        return response.data;
    },

    async getPaymentGateway() {
        const response = await apiClient.get('/api/admin/billing/payment-gateway');
        return response.data;
    },

    async updatePaymentGateway(payload) {
        const response = await apiClient.put('/api/admin/billing/payment-gateway', payload);
        return response.data;
    },

    async testPaymentGateway() {
        const response = await apiClient.post('/api/admin/billing/payment-gateway/test');
        return response.data;
    },

    async getPaymentGatewayChannels() {
        const response = await apiClient.get('/api/admin/billing/payment-gateway/channels');
        return response.data;
    },

    async getCameraIps() {
        const response = await apiClient.get('/api/admin/billing/camera-ips');
        return response.data;
    },

    async getPromos() {
        const response = await apiClient.get('/api/admin/billing/promos');
        return response.data;
    },

    async createPromo(payload) {
        const response = await apiClient.post('/api/admin/billing/promos', payload);
        return response.data;
    },

    async updatePromo(id, payload) {
        const response = await apiClient.put(`/api/admin/billing/promos/${id}`, payload);
        return response.data;
    },

    async deletePromo(id) {
        const response = await apiClient.delete(`/api/admin/billing/promos/${id}`);
        return response.data;
    },

    async getRegistrations() {
        const response = await apiClient.get('/api/admin/billing/registrations');
        return response.data;
    },

    async approveRegistration(id) {
        const response = await apiClient.post(`/api/admin/billing/registrations/${id}/approve`);
        return response.data;
    },

    async rejectRegistration(id) {
        const response = await apiClient.post(`/api/admin/billing/registrations/${id}/reject`);
        return response.data;
    },

    async getRegistrationSettings() {
        const response = await apiClient.get('/api/admin/billing/registration-settings');
        return response.data;
    },

    async updateRegistrationSettings(payload) {
        const response = await apiClient.put('/api/admin/billing/registration-settings', payload);
        return response.data;
    },
};

export default billingAdminService;
