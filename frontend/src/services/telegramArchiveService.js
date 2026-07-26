/*
 * Purpose: Admin API client for Telegram recording-archive routing (which camera/area is uploaded
 *          to which Telegram group) served from /api/admin/telegram-archive.
 * Caller: pages/TelegramArchiveSettings.jsx (admin).
 * Deps: shared apiClient (cookies + CSRF + retry).
 * MainFuncs: getOverview, getActivity, createRoute, updateRoute, deleteRoute, verifyChat.
 * SideEffects: HTTP requests only.
 */

import apiClient from './apiClient';

export const telegramArchiveService = {
    async getOverview() {
        const response = await apiClient.get('/api/admin/telegram-archive/overview');
        return response.data;
    },

    async getActivity() {
        const response = await apiClient.get('/api/admin/telegram-archive/activity');
        return response.data;
    },

    async createRoute(payload) {
        const response = await apiClient.post('/api/admin/telegram-archive/routes', payload);
        return response.data;
    },

    async updateRoute(id, patch) {
        const response = await apiClient.put(
            `/api/admin/telegram-archive/routes/${encodeURIComponent(id)}`, patch,
        );
        return response.data;
    },

    async deleteRoute(id) {
        const response = await apiClient.delete(
            `/api/admin/telegram-archive/routes/${encodeURIComponent(id)}`,
        );
        return response.data;
    },

    // Asks the server to resolve the chat id through the bot before the operator saves it —
    // a wrong id otherwise only surfaces hours later as failed uploads.
    async verifyChat(chatId) {
        const response = await apiClient.post('/api/admin/telegram-archive/verify-chat', { chatId });
        return response.data;
    },
};

export default telegramArchiveService;
