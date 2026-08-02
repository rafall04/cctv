/*
 * Purpose: Public API client for per-camera visitor feedback — the one-tap verdict.
 * Caller: components/MultiView/CameraReactionBar.jsx.
 * Deps: apiClient.
 * MainFuncs: getReaction, setReaction.
 * SideEffects: Sends public requests; the server may set the shared device cookie on a write.
 *
 * Never throws. This sits under a live video player, and a failed feedback call must not be able to
 * take the player down with it — every method resolves to `{ success: false }` and the caller
 * simply renders nothing.
 */

import apiClient from './apiClient';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

export const cameraFeedbackService = {
    async getReaction(cameraId) {
        try {
            const response = await apiClient.get(`/api/public/cameras/${cameraId}/reaction`);
            return response.data;
        } catch (error) {
            return failure(error, 'Gagal memuat reaksi');
        }
    },

    /** @param {1|-1|0} value — like, dislike, or withdraw. */
    async setReaction(cameraId, value) {
        try {
            const response = await apiClient.post(`/api/public/cameras/${cameraId}/reaction`, { value });
            return response.data;
        } catch (error) {
            return failure(error, 'Gagal menyimpan reaksi');
        }
    },

    /*
     * Fetched rather than hardcoded so the form's options and the server's accepted set cannot
     * drift apart — a category the server rejects would be a dead radio button.
     */
    async getReportCategories() {
        try {
            const response = await apiClient.get('/api/public/cameras/report-categories');
            return response.data;
        } catch (error) {
            return failure(error, 'Gagal memuat jenis laporan');
        }
    },

    /** @param {{category: string, message?: string, occurredAt?: string}} payload */
    async submitReport(cameraId, payload) {
        try {
            const response = await apiClient.post(`/api/public/cameras/${cameraId}/report`, payload);
            return response.data;
        } catch (error) {
            return failure(error, 'Gagal mengirim laporan');
        }
    },
};

export default cameraFeedbackService;
