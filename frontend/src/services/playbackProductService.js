/*
 * Purpose: Admin API client for the public playback-access package catalogue.
 * Caller: hooks/admin/usePlaybackProductManagementPage.js.
 * Deps: apiClient.
 * MainFuncs: listProducts, createProduct, updateProduct.
 * SideEffects: Sends admin catalogue requests to the backend.
 *
 * Follows the same catch-and-return contract as the admin half of playbackTokenService: these never
 * throw and return `{ success: false, message }` so the page can surface the backend's own
 * Indonesian validation message ("Paket berbayar harus punya harga di atas 0") rather than a
 * generic failure. There is no delete method on purpose — playback_orders references these rows,
 * so removal is `enabled: false`, not deletion.
 */

import apiClient from './apiClient';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

export const playbackProductService = {
    /** Includes disabled packages — the admin page must be able to switch one back on. */
    async listProducts() {
        try {
            const response = await apiClient.get('/api/admin/playback-products');
            return response.data;
        } catch (error) {
            console.error('List playback products error:', error);
            return failure(error, 'Gagal memuat daftar paket');
        }
    },

    async createProduct(payload) {
        try {
            const response = await apiClient.post('/api/admin/playback-products', payload);
            return response.data;
        } catch (error) {
            console.error('Create playback product error:', error);
            return failure(error, 'Gagal membuat paket');
        }
    },

    async updateProduct(id, payload) {
        try {
            const response = await apiClient.put(`/api/admin/playback-products/${id}`, payload);
            return response.data;
        } catch (error) {
            console.error('Update playback product error:', error);
            return failure(error, 'Gagal memperbarui paket');
        }
    },
};

export default playbackProductService;
