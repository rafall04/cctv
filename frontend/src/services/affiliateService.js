/*
 * Purpose: Public API client for affiliate ("Toko rekanan") offers — resolve the single offer that
 *          belongs under one public viewing context, sanitise the payload before it becomes an
 *          <a href>, keep a client-side de-duplication guard so an impression is not counted again
 *          just because the viewer reopened the same popup, and count outbound taps.
 * Caller: components/commerce/UnderVideoCommerceSlot.jsx (resolve) and
 *          components/commerce/AffiliateOfferCard.jsx (click counting). Public surfaces only.
 * Deps: shared apiClient, requestPolicy (SILENT_PUBLIC).
 * MainFuncs: getPublicAffiliateOffer, resolveAffiliateOfferOnce, clearAffiliateOfferCache,
 *          buildAffiliateBeaconUrl, countAffiliateClick, AFFILIATE_LINK.
 * SideEffects: one GET per resolved context per day (the GET is what counts the impression
 *          server-side); one fire-and-forget beacon per outbound tap; reads/writes a few
 *          sessionStorage keys.
 *
 * Contract (mirrors promoBannerService): methods NEVER throw. On failure they return
 * `{ success: false, message }`. A context with no offer is `{ success: true, data: null }` —
 * that is the normal case on almost every camera, not an error, and must never raise a toast.
 *
 * ── What the server sends (payload v2) ────────────────────────────────────────────────────────
 * A hand-built allow-list of exactly thirteen keys, always present, null when unset:
 *     { id, product_title, description, store_name,
 *       product_url, store_url, product_href, store_href,
 *       whatsapp_url, price_rupiah, image_base, image_width, image_height }
 * Never partner_id, contact_note, the fee the operator charges the SHOP, targeting, schedule,
 * priority, stats, or any camera/area field.
 *
 * ── Why the REAL destination URL is now in the payload (this reverses phase 1) ────────────────
 * Phase 1 emitted only our own `/go` redirector and kept the partner's URL off the wire. That was
 * never a security property — a shop page is public by definition — it was a bet that a later
 * phase would not have to touch the frontend, and the bet cost the product.
 *
 * This site's PWA manifest is scope "/" with display "standalone", so a RELATIVE `/go` href is IN
 * SCOPE: an installed PWA handles that navigation itself, follows the 302, and parks the visitor
 * on a stranger's shop inside our shell — no address bar, no back affordance, and no second origin
 * to escape through (there is one origin; api-cctv.raf.my.id is NXDOMAIN, everything is proxied by
 * nginx). An absolute https:// href is OUT of scope, so Android hands it to the real browser. That
 * is the platform's own rule, not a workaround.
 *
 * `product_href` / `store_href` stay: they are the no-JS fallback, and the 302 they serve is what
 * counts a click for a visitor whose browser never ran our beacon.
 *
 * ── Why this module re-validates URLs the backend already validated ───────────────────────────
 * These values become `href` attributes. An href is the one payload field where a wrong value
 * stops being "a broken card" and becomes navigation the visitor did not ask for. The backend's
 * utils/outboundUrlPolicy.js is the authority; the checks below are the same rules restated on the
 * consumer side, so a regression there — or a proxy rewriting a response — cannot put
 * `javascript:` into a public page through this component. Anything we cannot vouch for is
 * dropped to null, exactly as the backend does, and the card then falls back to `/go`.
 */

import apiClient from './apiClient';
import { REQUEST_POLICY } from './requestPolicy';

const BASE = '/api/public/affiliate';

/*
 * Our own redirector prefix. `product_href` / `store_href` must start with it.
 *
 * Requiring a leading `/api/public/affiliate/offers/` makes those two anchors same-origin by
 * construction, whatever a proxy or a future backend change puts in the field.
 */
const GO_HREF_PREFIX = '/api/public/affiliate/offers/';

/** sessionStorage namespace. Session-scoped on purpose — see rememberOffer() below. */
const CONTEXT_KEY_PREFIX = 'raf.affiliate.ctx.';
const SEEN_KEY_PREFIX = 'raf.affiliate.seen.';

/** The thirteen keys the public payload is allowed to carry, in payload order. */
const PUBLIC_OFFER_KEYS = [
    'id', 'product_title', 'description', 'store_name',
    'product_url', 'store_url', 'product_href', 'store_href',
    'whatsapp_url', 'price_rupiah',
    'image_base', 'image_width', 'image_height',
];

/** Mirrors the backend cap in utils/outboundUrlPolicy.js. */
const OUTBOUND_MAX_LENGTH = 1000;

/**
 * The two official WhatsApp deep-link hosts. The backend builds `wa.me`; `api.whatsapp.com` is
 * accepted because it is the same product under its other name, and a button labelled "Tanya
 * barang ini" that opened anything else would be a lie regardless of whether the URL is safe.
 */
const WHATSAPP_HOSTS = new Set(['wa.me', 'api.whatsapp.com']);

/**
 * An image base is interpolated straight into a media path (`/api/affiliate-media/<base>-320.webp`),
 * so it is a filename, not free text. Same shape as the backend's allowlist: lowercase
 * alphanumerics and dashes, nothing that can climb out of the directory or open a query string.
 */
const IMAGE_BASE_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The three things a visitor can tap, and the letters the backend counts them under. */
export const AFFILIATE_LINK = Object.freeze({ PRODUCT: 'p', STORE: 's', WHATSAPP: 'w' });

const COUNTABLE_LINKS = Object.freeze(['p', 's', 'w']);

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
 * Consumer-side echo of backend utils/outboundUrlPolicy.js: parse with the SAME algorithm the
 * browser will run (WHATWG `new URL`), require https, refuse embedded credentials.
 *
 * A prefix test like `/^https:\/\//` agrees with a human reading the string but not with the
 * browser — it passes `https://toko-asli.example@evil.test`, whose real host is evil.test. Parsing
 * is the only check that cannot disagree with the consumer. A relative path throws here (no base),
 * which is deliberate: our own `/go` redirector must never arrive dressed as an outbound URL.
 */
function isSafeOutboundUrl(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const raw = value.trim();
    if (!raw || raw.length > OUTBOUND_MAX_LENGTH) {
        return false;
    }
    let parsed;
    try {
        parsed = new URL(raw);
    } catch {
        return false;
    }
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
}

function isSafeWhatsAppUrl(value) {
    if (!isSafeOutboundUrl(value)) {
        return false;
    }
    try {
        return WHATSAPP_HOSTS.has(new URL(value.trim()).hostname.toLowerCase());
    } catch {
        return false;
    }
}

function safeOutbound(value) {
    return isSafeOutboundUrl(value) ? value.trim() : null;
}

/**
 * Price is INTEGER rupiah end to end (Critical Invariant).
 *
 * `null` and `0` are DIFFERENT and the difference is the whole feature: null means "this offer
 * does not advertise a price" and hides the line; 0 is a price of zero rupiah and renders. A `||`
 * default anywhere on this path would quietly turn "no price" into "free", so the test is
 * `Number.isInteger`, never truthiness.
 */
function safePrice(value) {
    return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeDimension(value) {
    return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * Reduce whatever arrived to exactly the thirteen public keys, or null.
 *
 * Three jobs:
 *  1. "No offer here" can arrive as `null`, `{}` or `[]` depending on the proxy in front of us,
 *     and the last two are truthy enough to render an empty card. Require the fields the card
 *     actually needs (an id, a title, and at least one usable way to reach the product) rather
 *     than a merely truthy `data`.
 *  2. Copy ONLY the allow-listed keys. The backend already hand-builds this list — no camera name,
 *     no area, no partner id, no fee, no schedule — and re-picking here means a regression on that
 *     side cannot leak an extra field onto a public surface through this component, nor park one
 *     in sessionStorage.
 *  3. Vouch for every field that becomes an href or a media path. A doubtful value becomes null,
 *     which the card reads as "this part of the offer does not exist" — presence is the switch, on
 *     this side of the wire too.
 *
 * The image trio is all-or-nothing: a width with no picture is worse than no picture.
 */
function toPublicOffer(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
        return null;
    }

    const productUrl = safeOutbound(data.product_url);
    const productHref = isInternalGoHref(data.product_href) ? data.product_href : null;
    if (!data.id || !data.product_title || (!productUrl && !productHref)) {
        return null;
    }

    const offer = {};
    for (const key of PUBLIC_OFFER_KEYS) {
        offer[key] = data[key] ?? null;
    }

    offer.product_url = productUrl;
    offer.product_href = productHref;
    // A store link is optional (the partner may have no shop URL) and each half is dropped
    // independently: a bad store_url still leaves the countable /go fallback usable.
    offer.store_url = safeOutbound(offer.store_url);
    offer.store_href = isInternalGoHref(offer.store_href) ? offer.store_href : null;
    offer.whatsapp_url = isSafeWhatsAppUrl(offer.whatsapp_url) ? offer.whatsapp_url.trim() : null;
    offer.price_rupiah = safePrice(offer.price_rupiah);

    const hasImage = typeof offer.image_base === 'string' && IMAGE_BASE_RE.test(offer.image_base);
    offer.image_base = hasImage ? offer.image_base : null;
    offer.image_width = hasImage ? safeDimension(offer.image_width) : null;
    offer.image_height = hasImage ? safeDimension(offer.image_height) : null;

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

/**
 * The URL that counts one tap without redirecting anywhere: `…/go?l=<p|s|w>&beacon=1` → 204.
 *
 * Built here rather than in JSX so the shape lives in one place, and validated rather than
 * interpolated blindly: `link` may only ever be one of three letters and the id only a positive
 * integer, so nothing a payload carries can turn this into a request to somewhere else.
 *
 * Relative on purpose. Everything is proxied on a single origin by nginx (the payload's own `/go`
 * hrefs already depend on that), and same-origin is what makes the backend's Sec-Fetch-Site gate
 * accept the count.
 *
 * @param {number|string} offerId
 * @param {'p'|'s'|'w'} link
 * @returns {string|null} null when either argument is not something we will send
 */
export const buildAffiliateBeaconUrl = (offerId, link) => {
    const id = Number(offerId);
    if (!Number.isInteger(id) || id <= 0 || !COUNTABLE_LINKS.includes(link)) {
        return null;
    }
    return `${BASE}/offers/${id}/go?l=${link}&beacon=1`;
};

/**
 * Count one outbound tap. Fire-and-forget: never awaited, never blocking, never throwing.
 *
 * The visitor's navigation is the point of the click; the statistic is our bookkeeping. So every
 * branch here is wrapped and every failure is swallowed — a counter that could delay or break a
 * tap would be trading the visitor's experience for our invoice.
 *
 * ── Why fetch(keepalive) is tried BEFORE navigator.sendBeacon ─────────────────────────────────
 * sendBeacon ALWAYS issues a POST — the spec gives no way to make it a GET — and the counting
 * endpoint is registered as `fastify.get(…/offers/:id/go)`. A sendBeacon-first implementation
 * would therefore POST into a GET-only route, take a 404, and report success (sendBeacon returns
 * true when the request is merely QUEUED, so the 404 is invisible): every JS-counted click would
 * vanish silently, which is the worst possible failure for a number that goes on an invoice.
 * `fetch(url, { method: 'GET', keepalive: true })` is the same "survives the page going away"
 * guarantee against the method the route actually serves.
 * sendBeacon stays as the fallback for a browser without fetch keepalive; should the backend ever
 * accept POST on that path too, it will work there as well.
 *
 * `credentials: 'omit'` — counting a tap needs no session, and a public page should not send
 * cookies it does not need. `cache: 'no-store'` — a cached 204 would silently suppress the next
 * count.
 *
 * @param {number|string} offerId
 * @param {'p'|'s'|'w'} link - product, store, or WhatsApp
 * @returns {boolean} whether a request was dispatched (false = nothing to send, or no transport)
 */
export const countAffiliateClick = (offerId, link) => {
    const url = buildAffiliateBeaconUrl(offerId, link);
    if (!url) {
        return false;
    }

    try {
        if (typeof fetch === 'function') {
            const pending = fetch(url, {
                method: 'GET',
                keepalive: true,
                credentials: 'omit',
                cache: 'no-store',
            });
            // Nothing awaits this, so an unhandled rejection is the only way it could reach the
            // console of a visitor who did nothing wrong.
            if (pending && typeof pending.catch === 'function') {
                pending.catch(() => {});
            }
            return true;
        }
    } catch {
        /* fall through to the beacon transport */
    }

    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            return navigator.sendBeacon(url) === true;
        }
    } catch {
        /* no transport left — an uncounted click is not the visitor's problem */
    }

    return false;
};

export default {
    getPublicAffiliateOffer,
    resolveAffiliateOfferOnce,
    clearAffiliateOfferCache,
    buildAffiliateBeaconUrl,
    countAffiliateClick,
    AFFILIATE_LINK,
};
