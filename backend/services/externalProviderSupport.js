/*
 * Purpose: Per-provider adaptations for external CCTV sources that a generic
 *          HLS fetch cannot serve as-is.
 *
 *   - Provider session headers (opaque proxy path): some origins refuse plain
 *     GETs — e.g. cctv.malangkota.go.id requires a session cookie minted by
 *     visiting their page AND a matching Referer. attachProviderInterceptors()
 *     injects those headers on every upstream axios call and re-mints + retries
 *     ONCE on a 403, transparent to the call sites.
 *   - Provider stream bootstrap (direct path): sources like
 *     cctvkanjeng.gresikkab.go.id run streams ON DEMAND — their m3u8 404s until
 *     POST /public/cctv/{id}/start is called. buildExternalStartUrl() hands the
 *     browser that start endpoint so the viewer's own browser wakes the stream
 *     (zero server load); the UUID rides in cameras.source_profile as
 *     'gresikkab:<uuid>'.
 *
 * Caller: externalStreamProxyService (proxy headers), streamService (start URL).
 * Deps: none — plain fetch for session minting so no axios/self recursion.
 * SideEffects: in-memory cookie jar per provider host; upstream page fetches.
 */

// ---- provider registry -----------------------------------------------------
// Keyed by URL hostname. `sessionUrl` is a page that mints the cookies the
// stream endpoints demand; `headers` are the static extras sent upstream.
const PROVIDERS = [
    {
        id: 'malangkota',
        host: 'cctv.malangkota.go.id',
        sessionUrl: 'https://cctv.malangkota.go.id/sebaran-cctv',
        referer: 'https://cctv.malangkota.go.id/',
    },
];

// Conservative refresh: observed cookie lifetime is ~30 days, but a short jar
// TTL keeps us immune to silent server-side rotation; minting is one GET.
const SESSION_TTL_MS = 10 * 60 * 1000;
const SESSION_FETCH_TIMEOUT_MS = 10000;

// host -> { cookieHeader, expiresAt } | { inflight: Promise }
const sessions = new Map();

function providerForUrl(targetUrl) {
    try {
        const host = new URL(targetUrl).hostname;
        return PROVIDERS.find((p) => host === p.host) || null;
    } catch {
        return null;
    }
}

async function mintSession(provider) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_FETCH_TIMEOUT_MS);
    try {
        const res = await fetch(provider.sessionUrl, {
            signal: controller.signal,
            redirect: 'follow',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            },
        });
        const setCookies = res.headers.getSetCookie?.() || [];
        const cookieHeader = setCookies
            .map((c) => String(c).split(';')[0])
            .filter(Boolean)
            .join('; ');
        return cookieHeader || null;
    } catch (error) {
        console.error(`[ExternalProvider] session mint failed for ${provider.host}:`, error.message);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

async function getSessionCookie(provider, { forceRefresh = false } = {}) {
    const now = Date.now();
    const cached = sessions.get(provider.host);
    if (!forceRefresh && cached?.cookieHeader && cached.expiresAt > now) {
        return cached.cookieHeader;
    }
    if (cached?.inflight) return cached.inflight;

    const inflight = (async () => {
        const cookieHeader = await mintSession(provider);
        sessions.set(provider.host, cookieHeader
            ? { cookieHeader, expiresAt: now + SESSION_TTL_MS }
            : { cookieHeader: null, expiresAt: now + 30 * 1000 }); // short negative cache
        return cookieHeader;
    })().finally(() => {
        const cur = sessions.get(provider.host);
        if (cur?.inflight) sessions.set(provider.host, { ...cur, inflight: null });
    });
    sessions.set(provider.host, { ...(cached || {}), inflight });
    return inflight;
}

/**
 * Axios interceptors for provider-gated upstreams. On request: merge Referer +
 * session Cookie when the target host has a registered provider. On a resolved
 * 403 (the httpClient accepts all statuses) the session is re-minted and the
 * request retried ONCE — flagged via cfg.__providerRetried so a persistently
 * dead/blocked upstream cannot loop.
 */
export function attachProviderInterceptors(httpClient) {
    if (!httpClient?.interceptors) return httpClient; // injected test doubles lack interceptors
    httpClient.interceptors.request.use(async (cfg) => {
        const provider = providerForUrl(cfg.url || '');
        if (!provider) return cfg;
        const cookie = await getSessionCookie(provider);
        cfg.headers = cfg.headers || {};
        cfg.headers.Referer = provider.referer;
        if (cookie) cfg.headers.Cookie = cookie;
        return cfg;
    });

    httpClient.interceptors.response.use(async (response) => {
        const cfg = response.config || {};
        const provider = providerForUrl(cfg.url || '');
        if (!provider || response.status !== 403 || cfg.__providerRetried) {
            return response;
        }
        cfg.__providerRetried = true;
        await getSessionCookie(provider, { forceRefresh: true });
        return httpClient.request(cfg);
    });
    return httpClient;
}

// ---- on-demand stream bootstrap (direct browser path) ----------------------

/**
 * cameras.source_profile carries '<provider>:<providerCameraRef>'. Returns the
 * provider-side start endpoint the browser must POST before the m3u8 exists,
 * or null when the camera has no on-demand provider.
 */
export function buildExternalStartUrl(camera) {
    const profile = String(camera?.source_profile || '');
    const sep = profile.indexOf(':');
    if (sep <= 0) return null;
    const provider = profile.slice(0, sep);
    const ref = profile.slice(sep + 1);
    if (!ref) return null;
    if (provider === 'gresikkab' && /^[A-Za-z0-9_-]{1,80}$/.test(ref)) {
        return `https://cctvkanjeng.gresikkab.go.id/api/v1/public/cctv/${ref}/start`;
    }
    return null;
}

export function resetExternalProviderForTests() {
    sessions.clear();
}
