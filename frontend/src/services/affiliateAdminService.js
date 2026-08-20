/*
 * Purpose: Admin API client for the affiliate feature — partners (the shop + the commercial deal),
 *          offers (the product shown under a live camera), and the per-offer daily stats.
 * Caller: pages/AffiliateManagement.jsx and components/admin/affiliate/*.
 * Deps: services/apiClient (axios instance with CSRF + auth refresh).
 * MainFuncs: listPartners, getPartner, createPartner, updatePartner, deletePartner,
 *            listOffers, getOffer, createOffer, updateOffer, deleteOffer, getOfferStats,
 *            normalizePlacements, normalizeTargetIds.
 * SideEffects: HTTP against /api/admin/affiliate/* (admin session required).
 *
 * WHY THE BASE IS /api/admin/affiliate AND NOT /api/affiliate
 * ----------------------------------------------------------
 * RATE_LIMIT_CONFIG.adminPrefixes in backend/middleware/rateLimiter.js is ['/api/admin']. A base
 * outside that prefix would silently drop this CRUD into the 100/min PUBLIC bucket — an operator
 * editing a batch of products would start getting 429s with nothing in the UI explaining why.
 * The public half of the feature lives under /api/public/affiliate for the mirror-image reason
 * (apiKeyValidator.js whitelists that prefix) and is NOT called from this file.
 *
 * CONTRACT: no method here throws. Failures come back as { success: false, message } so callers
 * branch on `result.success` — the same shape promoBannerService.js uses, so a page can hold both
 * without two error idioms.
 */

import apiClient from './apiClient';

const BASE = '/api/admin/affiliate';

function failure(error, fallback) {
    return {
        success: false,
        message: error.response?.data?.message || error.message || fallback,
    };
}

/* ------------------------------------------------------------------ partners */

export const listPartners = async () => {
    try {
        const response = await apiClient.get(`${BASE}/partners`);
        return response.data;
    } catch (error) {
        console.error('List affiliate partners error:', error);
        return failure(error, 'Gagal memuat daftar mitra');
    }
};

export const getPartner = async (id) => {
    try {
        const response = await apiClient.get(`${BASE}/partners/${id}`);
        return response.data;
    } catch (error) {
        console.error('Get affiliate partner error:', error);
        return failure(error, 'Gagal memuat mitra');
    }
};

export const createPartner = async (payload) => {
    try {
        const response = await apiClient.post(`${BASE}/partners`, payload);
        return response.data;
    } catch (error) {
        console.error('Create affiliate partner error:', error);
        return failure(error, 'Gagal menyimpan mitra');
    }
};

export const updatePartner = async (id, payload) => {
    try {
        const response = await apiClient.put(`${BASE}/partners/${id}`, payload);
        return response.data;
    } catch (error) {
        console.error('Update affiliate partner error:', error);
        return failure(error, 'Gagal memperbarui mitra');
    }
};

export const deletePartner = async (id) => {
    try {
        const response = await apiClient.delete(`${BASE}/partners/${id}`);
        return response.data;
    } catch (error) {
        console.error('Delete affiliate partner error:', error);
        return failure(error, 'Gagal menghapus mitra');
    }
};

/* -------------------------------------------------------------------- offers */

export const listOffers = async () => {
    try {
        const response = await apiClient.get(`${BASE}/offers`);
        return response.data;
    } catch (error) {
        console.error('List affiliate offers error:', error);
        return failure(error, 'Gagal memuat daftar barang');
    }
};

export const getOffer = async (id) => {
    try {
        const response = await apiClient.get(`${BASE}/offers/${id}`);
        return response.data;
    } catch (error) {
        console.error('Get affiliate offer error:', error);
        return failure(error, 'Gagal memuat barang');
    }
};

export const createOffer = async (payload) => {
    try {
        const response = await apiClient.post(`${BASE}/offers`, payload);
        return response.data;
    } catch (error) {
        console.error('Create affiliate offer error:', error);
        return failure(error, 'Gagal menyimpan barang');
    }
};

export const updateOffer = async (id, payload) => {
    try {
        const response = await apiClient.put(`${BASE}/offers/${id}`, payload);
        return response.data;
    } catch (error) {
        console.error('Update affiliate offer error:', error);
        return failure(error, 'Gagal memperbarui barang');
    }
};

export const deleteOffer = async (id) => {
    try {
        const response = await apiClient.delete(`${BASE}/offers/${id}`);
        return response.data;
    } catch (error) {
        console.error('Delete affiliate offer error:', error);
        return failure(error, 'Gagal menghapus barang');
    }
};

/**
 * Daily stats rollup for one offer. `days` is a window, not a date range — the backend resolves
 * "today" with the app's WIB helper, never the browser clock, so two operators in different
 * timezones read the same numbers.
 */
export const getOfferStats = async (id, days = 30) => {
    try {
        const response = await apiClient.get(`${BASE}/offers/${id}/stats`, { params: { days } });
        return response.data;
    } catch (error) {
        console.error('Get affiliate offer stats error:', error);
        return failure(error, 'Gagal memuat statistik');
    }
};

/* ------------------------------------------------- outbound URL policy (mirror)
 *
 * Lives here, next to the client both forms already import, so the partner form and the offer
 * form validate a link the SAME way — a security-shaped check duplicated in two components drifts
 * the moment one of them is touched.
 *
 * The backend (backend/utils/outboundUrlPolicy.js) is the authority and re-validates every write;
 * this exists so the operator is told before the round trip. It must therefore never be LOOSER
 * than the rule it advertises: parse with `new URL()`, not a `^https://` prefix test, because a
 * prefix test passes strings whose scheme has been broken up with a tab or newline.
 */

/**
 * @param {string} raw the operator's input
 * @param {{ required?: boolean }} [options]
 * @returns {string|null} human-readable reason it would be rejected, or null when acceptable
 */
export function describeOutboundUrlProblem(raw, { required = false } = {}) {
    const value = String(raw ?? '').trim();
    if (!value) {
        return required ? 'Link wajib diisi.' : null;
    }
    if (value.length > 1000) {
        return 'Link terlalu panjang (maksimal 1000 karakter).';
    }
    /*
     * Space and every C0 control (plus DEL) are refused. Checked by char code rather than by a
     * regex because ESLint's `no-control-regex` — on via eslint:recommended — forbids writing the
     * control range into a pattern.
     */
    const hasControlOrSpace = [...value].some((char) => {
        const code = char.charCodeAt(0);
        return code <= 0x20 || code === 0x7f;
    });
    if (hasControlOrSpace) {
        return 'Link tidak boleh mengandung spasi atau karakter kontrol.';
    }
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        return 'Link tidak valid. Contoh: https://tokoku.example.com/etalase';
    }
    if (parsed.protocol !== 'https:') {
        return 'Link harus https:// (http, data:, javascript: ditolak).';
    }
    if (!parsed.hostname) {
        return 'Link tidak punya nama domain.';
    }
    if (parsed.username || parsed.password) {
        return 'Link tidak boleh memuat user:password.';
    }
    return null;
}

/* ------------------------------------------------------- read-side normalisers
 *
 * `placements` is stored as a JSON-array TEXT column and the targets are rows in
 * affiliate_offer_targets. Whether the backend hands them back already parsed (array +
 * area_ids/camera_ids, the promo-banner shape) or raw is an implementation detail that must not
 * decide whether this page renders. Both helpers therefore accept either form and NEVER throw:
 * a malformed value degrades to an empty list, which shows up in the UI as "belum dipilih"
 * instead of a blank screen.
 */

export function normalizePlacements(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string');
    }
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
        } catch {
            return [];
        }
    }
    return [];
}

/**
 * Pull the ids for one target type out of whichever shape the offer row carries.
 * @param {object} offer row from listOffers/getOffer
 * @param {'area'|'camera'} type
 */
export function normalizeTargetIds(offer, type) {
    const direct = offer?.[type === 'area' ? 'area_ids' : 'camera_ids'];
    if (Array.isArray(direct)) {
        return direct.map(Number).filter(Number.isInteger);
    }
    if (Array.isArray(offer?.targets)) {
        return offer.targets
            .filter((target) => target?.target_type === type)
            .map((target) => Number(target.target_id))
            .filter(Number.isInteger);
    }
    return [];
}

export default {
    listPartners,
    getPartner,
    createPartner,
    updatePartner,
    deletePartner,
    listOffers,
    getOffer,
    createOffer,
    updateOffer,
    deleteOffer,
    getOfferStats,
    describeOutboundUrlProblem,
    normalizePlacements,
    normalizeTargetIds,
};
