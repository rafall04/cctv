/*
 * Purpose: Hand the inline <head> prefetch in index.html to the first matching service call.
 * Caller: Public-facing services (camera/area/branding/settings/growth/saweria/sponsor) and
 *   config/runtimeConfig.
 * Deps: window.__RAFNET_PREFETCH__ populated by index.html; fetch Promise semantics.
 * MainFuncs: takePrefetchedJson, peekPrefetchedJson.
 * SideEffects: Marks a key consumed so later calls (background refresh, remounts) hit the
 *   network through apiClient as usual.
 *
 * The inline script fires the landing's critical public GETs while the JS bundle is still
 * downloading, so the origin round-trip overlaps download+eval instead of queuing behind it.
 * Each key resolves to the PARSED JSON (the same envelope axios response.data would carry).
 * Failed prefetches delete themselves, so a consumer falling back to a fresh request is
 * automatic for keys nobody seeded — but a taken key that rejects still throws to the caller,
 * matching the service's normal error path.
 */

const consumed = new Set();

function store() {
    if (typeof window === 'undefined') {
        return null;
    }
    return window.__RAFNET_PREFETCH__ || null;
}

function isThenable(value) {
    return Boolean(value) && typeof value.then === 'function';
}

/**
 * Consume the prefetched JSON for `key` — only the FIRST call per key gets it, so periodic
 * refresh and remounts always see fresh network data.
 * @param {string} key
 * @returns {Promise<Object>|null} Parsed-response promise, or null when nothing was seeded.
 */
export function takePrefetchedJson(key) {
    if (consumed.has(key)) {
        return null;
    }
    const promise = store()?.[key];
    if (!isThenable(promise)) {
        return null;
    }
    consumed.add(key);
    return promise;
}

/**
 * Read a prefetched JSON promise WITHOUT consuming it — for data two independent modules both
 * need on one load (e.g. branding feeds meta-config.js's SEO tags AND BrandingContext's UI).
 * @param {string} key
 * @returns {Promise<Object>|null}
 */
export function peekPrefetchedJson(key) {
    const promise = store()?.[key];
    return isThenable(promise) ? promise : null;
}

/** Test seam: reset consumption marks so each test sees a clean slate. */
export function resetEarlyPrefetch() {
    consumed.clear();
    if (typeof window !== 'undefined') {
        delete window.__RAFNET_PREFETCH__;
    }
}
