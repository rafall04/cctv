/**
 * Promo Banner Service
 * API calls for the provider's own promo poster (house advertising).
 *
 * Not to be confused with `sponsorService` (third-party logos over the video) or
 * the Adsterra `ads_*` settings (network ad code) — a promo banner keeps showing
 * when network ads are switched off.
 *
 * Contract: methods never throw — on error they return
 * `{ success: false, message }`. Callers branch on `result.success`.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';
import { getApiUrl } from '../config/config.js';

const BASE = '/api/promo-banners';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

/**
 * Resolve the promo banner for one public viewing context (public).
 * `data` is null when no banner is configured for that context — that is the
 * normal case, not an error.
 */
export const getPublicPromoBanner = async ({ placement, cameraId, areaId } = {}) => {
    try {
        const response = await apiClient.get(`${BASE}/public`, {
            params: {
                placement,
                ...(cameraId ? { cameraId } : {}),
                ...(areaId ? { areaId } : {}),
            },
            requestPolicy: REQUEST_POLICY.SILENT_PUBLIC,
        });
        return response.data;
    } catch (error) {
        // A missing promo must never surface as an error toast on a public page.
        return failure(error, 'Gagal memuat promo');
    }
};

/**
 * Count an outbound CTA click (public, fire-and-forget).
 *
 * Uses sendBeacon where available so the request survives the navigation to
 * WhatsApp that happens immediately afterwards.
 */
export const trackPromoBannerClick = (promoId) => {
    if (!promoId) {
        return;
    }
    // Resolved per call, not from apiClient.defaults — the client rewrites baseURL
    // per request, so the module-load value can be stale.
    const url = `${getApiUrl() || ''}${BASE}/${promoId}/click`;
    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            navigator.sendBeacon(url);
            return;
        }
        apiClient.post(`${BASE}/${promoId}/click`, null, {
            requestPolicy: REQUEST_POLICY.SILENT_PUBLIC,
        }).catch(() => { /* stats are best-effort */ });
    } catch {
        /* stats are best-effort — never block the user's outbound click */
    }
};

/* --------------------------------------------------------------------- admin */

export const getAllPromoBanners = async () => {
    try {
        const response = await apiClient.get(BASE);
        return response.data;
    } catch (error) {
        console.error('Get promo banners error:', error);
        return failure(error, 'Gagal memuat promo');
    }
};

export const createPromoBanner = async (payload) => {
    try {
        const response = await apiClient.post(BASE, payload);
        return response.data;
    } catch (error) {
        console.error('Create promo banner error:', error);
        return failure(error, 'Gagal membuat promo');
    }
};

export const updatePromoBanner = async (id, payload) => {
    try {
        const response = await apiClient.put(`${BASE}/${id}`, payload);
        return response.data;
    } catch (error) {
        console.error('Update promo banner error:', error);
        return failure(error, 'Gagal memperbarui promo');
    }
};

export const deletePromoBanner = async (id) => {
    try {
        const response = await apiClient.delete(`${BASE}/${id}`);
        return response.data;
    } catch (error) {
        console.error('Delete promo banner error:', error);
        return failure(error, 'Gagal menghapus promo');
    }
};

/**
 * Upload/replace the poster. `base64` is the bare base64 payload (no data: prefix).
 */
export const uploadPromoBannerImage = async (id, base64) => {
    try {
        const response = await apiClient.post(`${BASE}/${id}/image`, { data: base64 });
        return response.data;
    } catch (error) {
        console.error('Upload promo image error:', error);
        return failure(error, 'Gagal mengunggah gambar');
    }
};

export const getPromoBannerStats = async (id, days = 30) => {
    try {
        const response = await apiClient.get(`${BASE}/${id}/stats`, { params: { days } });
        return response.data;
    } catch (error) {
        console.error('Get promo stats error:', error);
        return failure(error, 'Gagal memuat statistik');
    }
};

export default {
    getPublicPromoBanner,
    trackPromoBannerClick,
    getAllPromoBanners,
    createPromoBanner,
    updatePromoBanner,
    deletePromoBanner,
    uploadPromoBannerImage,
    getPromoBannerStats,
};
