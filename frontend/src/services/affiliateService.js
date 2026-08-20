/*
 * Purpose: Public API client for affiliate ("Toko rekanan") offers — resolve the single offer that
 *          belongs under one public viewing context, plus a client-side de-duplication guard so an
 *          impression is not counted again just because the viewer reopened the same popup.
 * Caller: components/commerce/UnderVideoCommerceSlot.jsx (public surfaces only).
 * Deps: shared apiClient, requestPolicy (SILENT_PUBLIC).
 * MainFuncs: getPublicAffiliateOffer, resolveAffiliateOfferOnce, clearAffiliateOfferCache.
 * SideEffects: one GET per resolved context per day (the GET is what counts the impression
 *          server-side); reads/writes a few sessionStorage keys.
 *
 * Contract (mirrors promoBannerService): methods NEVER throw. On failure they return
 * `{ success: false, message }`. A context with no offer is `{ success: true, data: null }` —
 * that is the normal case on almost every camera, not an error, and must never raise a toast.
 *
 * ── What the server sends ─────────────────────────────────────────────────────────────────────
 * The public payload is a hand-built allow-list of exactly six keys:
 *     { id, product_title, description, store_name, product_href, store_href }
 * `product_href` / `store_href` are OUR OWN redirector paths
 * (`/api/public/affiliate/offers/<id>/go?l=p|s`), never the partner's URL: the raw outbound URL
 * is deliberately kept off the public wire, and the redirect re-checks liveness on read, so a
 * deactivated partner stops working immediately instead of keeping a live redirector on this
 * domain. This module therefore never builds a partner URL — it passes hrefs through as-is.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';

const BASE = '/api/public/affiliate';

/*
 * Our own redirector prefix. Every href in the payload must start with it.
 *
 * This is a cheap containment check, not paranoia about our own backend: an href is rendered
 * straight into an <a href>, and an href is the one payload field where a wrong value stops being
 * "a broken card" and becomes navigation the visitor did not ask for (`javascript:`, another
 * origin). Requiring a leading `/api/public/affiliate/offers/` makes the anchor same-origin by
 * construction, whatever a proxy or a future backend change puts in the field.
 */
const GO_HREF_PREFIX = '/api/public/affiliate/offers/';

/** sessionStorage namespace. Session-scoped on purpose — see rememberOffer() below. */
const CONTEXT_KEY_PREFIX = 'raf.affiliate.ctx.';
const SEEN_KEY_PREFIX = 'raf.affiliate.seen.';

/** The six keys the public payload is allowed to carry, in payload order. */
const PUBLIC_OFFER_KEYS = ['id', 'product_title', 'description', 'store_name', 'product_href', 'store_href'];

function failure(error, fallback) {
    return {
        success: false,
        message: error?.response?.data?.message || error?.message || fallback,
    };
}

function isInternalGoHref(value) {
    return typeof value === 'string' && value.startsWith(GO_HREF_PREFIX);
}

/**
 * Reduce whatever arrived to exactly the six public keys, or null.
 *
 * Two jobs:
 *  1. "No offer here" can arrive as `null`, `{}` or `[]` depending on the proxy in front of us,
 *     and the last two are truthy enough to render an empty card. Require the fields the card
 *     actually needs (an id, a title, a usable product href) rather than a merely truthy `data`.
 *  2. Copy ONLY the allow-listed keys. The backend already hand-builds this list — no camera name,
 *     no area, no partner id, no price, no schedule — and re-picking here means a regression on
 *     that side cannot leak an extra field onto a public surface through this component, nor park
 *     one in sessionStorage.
 */
function toPublicOffer(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }
    if (!data.id || !data.product_title || !isInternalGoHref(data.product_href)) {
        return null;
    }

    const offer = {};
    for (const key of PUBLIC_OFFER_KEYS) {
        offer[key] = data[key] ?? null;
    }
    // A store link is optional (the partner may have no shop URL) and is dropped rather than
    // trusted if it is not one of our redirector paths.
    if (!isInternalGoHref(offer.store_href)) {
        offer.store_href = null;
    }
    return offer;
}

/**
 * Local calendar day, `YYYY-MM-DD`, from the device clock.
 *
 * Deliberately NOT an attempt to mirror the server's WIB `getLocalDate()`: this string only scopes
 * a client-side cache key. The stat row's date is decided by the backend and owes nothing to a
 * browser-supplied date — a viewer with a wrong clock gets a wrong cache bucket, never a wrong
 * stat.
 */
function localDayKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
}

/*
 * sessionStorage access is wrapped on both sides: Safari private mode and hardened/embedded
 * WebViews throw on READ as well as on write, and a shop link is never worth an exception on a
 * public page. Every failure degrades to "no cache", which only costs one extra impression.
 */
function readStorage(key) {
    try {
        return typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
    } catch {
        return null;
    }
}

function writeStorage(key, value) {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(key, value);
        }
    } catch {
        /* storage unavailable/full — the cache is an optimisation, never a requirement */
    }
}

function contextKey({ placement, cameraId, areaId }, day) {
    return `${CONTEXT_KEY_PREFIX}${placement || 'unknown'}:${cameraId ?? ''}:${areaId ?? ''}:${day}`;
}

function seenKey(offerId, day) {
    return `${SEEN_KEY_PREFIX}${offerId}:${day}`;
}

function readCachedOffer(key) {
    const raw = readStorage(key);
    if (!raw) {
        return null;
    }
    try {
        return toPublicOffer(JSON.parse(raw));
    } catch {
        return null;
    }
}

/**
 * Remember the offer this context resolved to, and mark that offer as counted for today.
 *
 * sessionStorage, not localStorage, on purpose: the guard exists to stop ACCIDENTAL repeats
 * inside one browsing session (reopening the popup, a route change, apiClient replaying a failed
 * GET). Suppressing an honest impression tomorrow, or in a tab the visitor opened fresh, is not
 * this guard's business — the backend's own throttle owns that.
 */
function rememberOffer(key, offer, day) {
    writeStorage(key, JSON.stringify(offer));
    writeStorage(seenKey(offer.id, day), '1');
}

/**
 * Resolve the affiliate offer for one public viewing context.
 *
 * The GET itself is what counts the impression server-side, which is why the caller defers it
 * behind an IntersectionObserver: an impression should mean the block reached the screen, not
 * merely that a popup opened.
 *
 * @param {object} ctx
 * @param {'popup'|'area'|'landing'|'playback'} ctx.placement - which surface is asking
 * @param {number} [ctx.cameraId] - camera in context (drives camera/area targeting server-side)
 * @param {number} [ctx.areaId] - area in context, when there is no single camera
 * @returns {Promise<{success: boolean, data?: object|null, message?: string}>}
 */
export const getPublicAffiliateOffer = async ({ placement, cameraId, areaId } = {}) => {
    try {
        const response = await apiClient.get(`${BASE}/offer`, {
            params: {
                placement,
                ...(cameraId ? { cameraId } : {}),
                ...(areaId ? { areaId } : {}),
            },
            requestPolicy: REQUEST_POLICY.SILENT_PUBLIC,
        });
        return {
            success: response.data?.success !== false,
            data: toPublicOffer(response.data?.data),
        };
    } catch (error) {
        // A missing/failed offer must never surface as an error toast on a public page.
        return failure(error, 'Gagal memuat penawaran');
    }
};

/**
 * Same resolve, but at most one network call per (context, day) inside this browsing session.
 *
 * Why this exists at all, given the backend already throttles: the popup is opened, closed and
 * reopened constantly on the same camera, and `apiClient` REPLAYS a failed GET twice
 * (NETWORK_RETRY_DELAYS_MS) after a tunnel re-dial. Each of those is a fresh GET, and each GET is
 * an impression. Caching the resolved payload per context per day means five reopens of the same
 * camera count once.
 *
 * Note this is a DELIBERATE divergence from PromoBanner, which has no such guard and re-counts on
 * every cameraId change: a house promo that is always available can afford a loose impression
 * number, an invoice-bearing partner statistic cannot.
 *
 * Only POSITIVE results are cached. A context with no offer re-asks next time — there is no
 * impression to protect, and caching "nothing here" for a whole session would hide an offer the
 * operator publishes while a viewer is still browsing.
 *
 * Honest limitation: two different contexts that happen to resolve to the SAME offer inside one
 * session count twice. Nothing client-side can prevent that — the offer id is only known after the
 * resolve, which is the call that counts.
 */
export const resolveAffiliateOfferOnce = async ({ placement, cameraId, areaId } = {}) => {
    const day = localDayKey();
    const key = contextKey({ placement, cameraId, areaId }, day);

    const cached = readCachedOffer(key);
    if (cached && readStorage(seenKey(cached.id, day))) {
        return { success: true, data: cached, fromCache: true };
    }

    const result = await getPublicAffiliateOffer({ placement, cameraId, areaId });
    if (result.success && result.data) {
        rememberOffer(key, result.data, day);
    }
    return { ...result, data: result.data ?? null, fromCache: false };
};

/**
 * Drop every cached context/seen key. Exposed for tests and for an operator preview flow that
 * needs to see a freshly published offer without opening a new tab.
 */
export const clearAffiliateOfferCache = () => {
    try {
        if (typeof sessionStorage === 'undefined') {
            return;
        }
        const doomed = [];
        for (let i = 0; i < sessionStorage.length; i += 1) {
            const key = sessionStorage.key(i);
            if (key && (key.startsWith(CONTEXT_KEY_PREFIX) || key.startsWith(SEEN_KEY_PREFIX))) {
                doomed.push(key);
            }
        }
        doomed.forEach((key) => sessionStorage.removeItem(key));
    } catch {
        /* storage unavailable — nothing was cached in the first place */
    }
};

export default {
    getPublicAffiliateOffer,
    resolveAffiliateOfferOnce,
    clearAffiliateOfferCache,
};
