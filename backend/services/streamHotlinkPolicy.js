/*
 * Purpose: Pure same-site policy for the community-playlist anti-hotlink gate — decides whether an HLS request came from our own site.
 * Caller: routes/hlsProxyRoutes.js (community playlist gate); unit-tested directly.
 * Deps: none (pure function over request headers + an allowlist Set).
 * MainFuncs: isTrustedStreamRequest.
 * SideEffects: None.
 */

/**
 * Anti-hotlink gate for community HLS PLAYLISTS.
 *
 * Why playlists only: a live HLS stream is unplayable without continuously
 * re-fetching its (no-cache) media playlist, so gating the playlist to our own
 * site blocks off-site embedding, direct address-bar playback, and link-sharing
 * — while the edge-cacheable media SEGMENTS stay untouched, so CDN performance
 * for 1000+ community cameras is preserved.
 *
 * Primary signal: `Sec-Fetch-Site` — sent automatically by every modern browser,
 * NOT settable by page JavaScript, and NOT stripped by referrer policy. The
 * stream host (api-cctv.raf.my.id) is a sibling subdomain of the SPA host
 * (cctv.raf.my.id), so legitimate playback is `same-site`, not `same-origin` —
 * both are trusted. `cross-site` (a <video> embedded on another domain) and
 * `none` (a URL pasted into the address bar) are rejected.
 *
 * Fallback for the rare browser that omits Sec-Fetch-Site: the Origin (sent on
 * cross-origin fetch/XHR) or Referer host must be in `allowedHosts`. With all
 * three signals absent — the signature of curl / a scraper — the request is
 * rejected. `allowedHosts` is a Set of lowercase hostnames.
 *
 * NOTE: only applied to community cameras. Non-community (owner_private /
 * subscriber) streams are already gated by a mandatory stream token upstream,
 * which is a stronger credential than any header signal.
 */
export function isTrustedStreamRequest(headers = {}, allowedHosts = new Set()) {
    const secFetchSite = headers['sec-fetch-site'];
    if (secFetchSite) {
        return secFetchSite === 'same-origin' || secFetchSite === 'same-site';
    }

    const hostOf = (value) => {
        if (!value || typeof value !== 'string') {
            return null;
        }
        try {
            return new URL(value).hostname.toLowerCase();
        } catch {
            return null;
        }
    };

    // Origin is authoritative when present (always sent on a cross-origin fetch);
    // if it is present but not allowed we reject without falling through to Referer.
    const originHost = hostOf(headers.origin);
    if (originHost !== null) {
        return allowedHosts.has(originHost);
    }
    const refererHost = hostOf(headers.referer);
    if (refererHost !== null) {
        return allowedHosts.has(refererHost);
    }
    return false;
}
