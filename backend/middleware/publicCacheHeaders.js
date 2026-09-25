/**
 * Public GET Cache-Control Middleware — HTTP-layer caching for anonymous read endpoints.
 *
 * `cacheMiddleware` is an in-memory origin cache only — it never emits `Cache-Control`, so
 * every browser and every Cloudflare edge pop re-hit the origin for data that is identical
 * for all visitors. The endpoints below serve anonymous, non-personalized payloads; a short
 * `public, max-age` lets the browser reuse them across navigations/remounts and lets any
 * downstream cache store them. Anything auth-gated or per-user is absent BY DESIGN — a path
 * that is not listed gets no Cache-Control from here at all.
 *
 * TTLs are deliberately short: status/flips surface within seconds anyway via the app's own
 * background refresh; these headers exist to absorb burst loads and repeat views, not to pin
 * stale data.
 */

import fp from 'fastify-plugin';

/**
 * [path, maxAgeSeconds] — matched against the queryless request path. Exact match, except the
 * `/api/public/areas/` prefix which legitimately covers `/api/public/areas/{slug}` and
 * `.../cameras` sub-resources (all anonymous-read).
 */
const PUBLIC_CACHE_RULES = [
    ['/api/cameras/active', 15],
    ['/api/areas/public', 60],
    ['/api/config/public', 60],
    ['/api/branding/public', 60],
    ['/api/settings/landing-page', 60],
    ['/api/settings/public-ads', 60],
    ['/api/settings/timezone', 300],
    ['/api/settings/map-center', 300],
    ['/api/sponsors/active', 60],
    ['/api/saweria/config', 60],
    ['/api/public/discovery', 30],
    ['/api/public/trending-cameras', 30],
];

const PUBLIC_CACHE_PREFIXES = [
    ['/api/public/areas/', 30],
];

function resolvePublicMaxAge(path) {
    for (const [rulePath, maxAge] of PUBLIC_CACHE_RULES) {
        if (path === rulePath) {
            return maxAge;
        }
    }
    for (const [prefix, maxAge] of PUBLIC_CACHE_PREFIXES) {
        if (path.startsWith(prefix)) {
            return maxAge;
        }
    }
    return null;
}

async function publicCacheHeadersPlugin(fastify) {
    fastify.addHook('onSend', async (request, reply) => {
        if (request.method !== 'GET' || reply.statusCode !== 200) {
            return;
        }

        const path = (request.raw?.url || request.url || '').split('?')[0];
        const maxAge = resolvePublicMaxAge(path);
        if (maxAge === null) {
            return;
        }

        // A handler that already decided its own Cache-Control (manifest's 1h, hlsProxy's
        // no-store) wins — this middleware only fills the gap, never overrides it.
        if (reply.getHeader('Cache-Control')) {
            return;
        }

        reply.header('Cache-Control', `public, max-age=${maxAge}, stale-while-revalidate=${maxAge * 4}`);
    });
}

export const publicCacheHeadersMiddleware = fp(publicCacheHeadersPlugin, {
    name: 'public-cache-headers',
    fastify: '5.x',
});

export { resolvePublicMaxAge };
