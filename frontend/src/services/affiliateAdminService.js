/*
 * Purpose: Admin API client for the affiliate feature — partners (the shop + the commercial deal),
 *          offers (the product shown under a live camera), and the per-offer daily stats.
 * Caller: pages/AffiliateManagement.jsx and components/admin/affiliate/*.
 * Deps: services/apiClient (axios instance with CSRF + auth refresh).
 * MainFuncs: listPartners, getPartner, createPartner, updatePartner, deletePartner,
 *            listOffers, getOffer, createOffer, updateOffer, deleteOffer, getOfferStats,
 *            uploadOfferImage, removeOfferImage, affiliateImageSrc,
 *            describeOutboundUrlProblem, describeWhatsAppNumberProblem,
 *            describeWhatsAppMessageProblem, toWhatsAppDigits,
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

/**
 * A stored image base is a FILENAME, not free text — see affiliateImageSrc below. Same shape as
 * the backend's allowlist (services/promoImageService.js) and the public client's.
 */
const IMAGE_BASE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Mirrors MAX_WHATSAPP_MESSAGE_LEN in backend/services/affiliateOfferExtras.js. The template is
 * percent-encoded into a wa.me URL that a phone hands to another app, so it is an opener and not
 * a brochure; the backend refuses a longer one on write and trims on read.
 */
export const MAX_WHATSAPP_MESSAGE_LEN = 300;

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

/* ------------------------------------------------------------- product photo */

/**
 * Store (or replace) the photo on one offer. Base64-in-JSON, `{ data }`, exactly like the promo
 * poster — that is the body shape the route parses, and the two uploads deliberately look the
 * same so an operator (and a reader of this file) recognises one from the other.
 *
 * The route is the ONLY affiliate endpoint allowed a body over the global 1MB cap, and the ceiling
 * is enforced twice on the server (inputSanitizer LARGE_BODY_ROUTES, then the route's bodyLimit).
 * Callers should still refuse an oversized file BEFORE reading it into memory: a 413 arriving
 * after a slow phone uplink has finished is a bad way to learn the picture was too big.
 *
 * @param {number|string} id offer id — the offer must already exist
 * @param {string} base64 payload WITHOUT the `data:image/...;base64,` prefix
 * @returns {Promise<{success: boolean, message?: string, data?: {offer: object, image: object}}>}
 */
export const uploadOfferImage = async (id, base64) => {
    try {
        const response = await apiClient.post(`${BASE}/offers/${id}/image`, { data: base64 });
        return response.data;
    } catch (error) {
        console.error('Upload affiliate offer image error:', error);
        return failure(error, 'Gagal mengunggah gambar');
    }
};

/**
 * Take the photo away again.
 *
 * There is no DELETE endpoint for the image, and that is deliberate: presence is the switch, so
 * "no photo" is just an offer whose image_base is NULL — the same write any other field clear is.
 * So removal is a normal offer update with `image_base: null` (the contract stated in
 * backend/routes/affiliateRoutes.js above the upload route).
 *
 * WHY THE RESPONSE IS RE-READ INSTEAD OF TRUSTED
 * ----------------------------------------------
 * A field the server does not recognise is silently ignored on a PUT — it does not 400. If the
 * write side ever stops honouring `image_base` (or never starts), a plain `result.success` would
 * hand the operator a green toast for a photo that is still on the public card, and they would
 * only find out by reloading. The update returns the stored row, so the honest check is right
 * there: if the photo survived the write, this reports a failure rather than a lie.
 *
 * @returns {Promise<{success: boolean, message?: string, data?: object}>}
 */
export const removeOfferImage = async (id) => {
    const result = await updateOffer(id, { image_base: null });
    if (!result.success) {
        return result;
    }
    if (result.data?.image_base) {
        return {
            success: false,
            message: 'Server masih menyimpan foto barang ini — fotonya belum terhapus. Coba lagi, '
                + 'dan kalau tetap begini laporkan: penghapusan foto tidak diproses.',
        };
    }
    return result;
};

/**
 * Build the admin preview URL for a stored photo, or null when the base is not a filename we are
 * willing to interpolate into a path.
 *
 * `image_base` comes out of the database and goes straight into an `<img src>`, so it is treated
 * as a filename and never as free text — the same allowlist the backend's media route enforces
 * (lowercase alphanumerics and dashes, nothing that can climb a directory or open a query string).
 * The admin panel is the highest-privilege browser context this app has; it does not get a looser
 * check than the anonymous one.
 *
 * @param {string} base value of affiliate_offers.image_base
 * @param {'320'|'160'} [rendition] the two sizes savePromoImage writes for affiliate photos
 */
export function affiliateImageSrc(base, rendition = '320') {
    const value = String(base ?? '').trim();
    if (!IMAGE_BASE_RE.test(value)) {
        return null;
    }
    return `/api/affiliate-media/${value}-${rendition}.webp`;
}

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

/* --------------------------------------------------- WhatsApp policy (mirror)
 *
 * Same arrangement, same reason as the URL mirror above: the backend
 * (services/affiliateOfferExtras.js) is the authority and re-validates every write, and this
 * exists only so the operator is told before the round trip — and so the panel can SHOW the
 * number that will actually be dialled.
 *
 * That last part is why an empty number can never be an error here. Empty is how the WhatsApp
 * button is switched off; there is no show_whatsapp flag to unset. A number that is present but
 * implausible IS refused, because a wa.me link to a number that does not exist fails silently
 * inside WhatsApp, where neither the operator nor we can see it.
 */

/**
 * Digits only, with an Indonesian leading 0 rewritten to the 62 country code — byte-identical
 * behaviour to backend toWhatsAppDigits(). Operators type the local `08xx` form; wa.me needs the
 * international one, and the two panels that take a WhatsApp number must not normalise it two
 * different ways.
 *
 * @returns {string} international digits, or '' when there is nothing to dial
 */
export function toWhatsAppDigits(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (!digits) {
        return '';
    }
    return digits.startsWith('0') ? `62${digits.slice(1)}` : digits;
}

/**
 * @returns {string|null} human-readable reason the number would be rejected, or null when it is
 *          acceptable — including when it is empty, which means "no button".
 */
export function describeWhatsAppNumberProblem(raw) {
    const digits = toWhatsAppDigits(raw);
    if (!digits) {
        return null;
    }
    if (digits.length < 9 || digits.length > 15) {
        return `Nomor terlihat tidak lengkap (${digits.length} digit). Harus 9-15 digit setelah kode negara, mis. 081234567890.`;
    }
    return null;
}

/** @returns {string|null} reason the template would be rejected, or null (empty = pakai bawaan). */
export function describeWhatsAppMessageProblem(raw) {
    const text = String(raw ?? '').trim();
    if (text.length > MAX_WHATSAPP_MESSAGE_LEN) {
        return `Pesan maksimal ${MAX_WHATSAPP_MESSAGE_LEN} karakter (sekarang ${text.length}).`;
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
    uploadOfferImage,
    removeOfferImage,
    affiliateImageSrc,
    describeOutboundUrlProblem,
    describeWhatsAppNumberProblem,
    describeWhatsAppMessageProblem,
    toWhatsAppDigits,
    MAX_WHATSAPP_MESSAGE_LEN,
    normalizePlacements,
    normalizeTargetIds,
};
