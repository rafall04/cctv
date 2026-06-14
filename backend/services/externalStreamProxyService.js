/*
Purpose: Opaque external-HLS proxy service (fastify plugin) — mount external CCTV streams under /api/stream/:id/external.* so the source URL never leaves the backend.
Caller: backend/server.js, registered alongside streamRoutes under the /api/stream prefix.
Deps: connectionPool (camera lookup), cameraHealthService (runtime signals), externalStreamCache, hlsProxyRoutes (shared fetch + validator helpers).
MainFuncs: registerExternalStreamProxyRoutes (fastify plugin), buildOpaqueSegmentUrl, rewriteOpaquePlaylist, resolveSegmentTargetUrl.
SideEffects: Proxies external streams + writes to playlist/segment caches. Records runtime signals on upstream contact.

Design vs the legacy /hls/proxy?url=...&cameraId=... route:
  - The full upstream URL no longer appears in the proxy URL — clients
    only see /api/stream/{cameraId}/external.m3u8 and
    /api/stream/{cameraId}/external-segment/{filename}. The actual
    government / Diskominfo URL is resolved from the DB on every call.
  - Filename is validated against a strict whitelist pattern before any
    URL composition, so a malformed query can't reach outside the
    camera's configured base path.
  - Each handler shares the same cache instances (G1) so cache hits for
    a popular external camera serve from memory regardless of which
    route path the viewer arrived through.
*/

import https from 'https';
import { queryOne } from '../database/connectionPool.js';
import cameraHealthService from '../services/cameraHealthService.js';
import { getAccessInfo, canViewLive } from '../services/cameraAccessService.js';
import { readVoucherDeviceHash } from '../services/voucherPass.js';
import {
    createPlaylistCache,
    createSegmentCache,
    TTL as EXTERNAL_CACHE_TTL,
} from '../services/externalStreamCache.js';
import {
    fetchTextUpstreamWithRetry,
    fetchBufferedBinaryUpstream,
    isExternalProxyTargetAllowed,
    isExternalProxyUrlCompatible,
    createHlsHttpClient,
    safeAbort,
    createHlsRouteState,
    verifyStreamToken,
    resolveHlsViewerUser,
} from '../services/hlsProxyService.js';
import { config } from '../config/config.js';

const DEFAULT_TIMEOUT_MS = 30000;
// Whitelist for the (decoded) path portion of an opaque `/external-segment`
// filename. We extend the original `.ts`/`.m4s`/`.mp4`/`.m3u8` set with
// the other HLS-related extensions a player may follow through one of
// the rewritten directive-URI tags below:
//   - .key / .bin → AES-128 encryption keys referenced by #EXT-X-KEY
//   - .vtt / .webvtt → WebVTT subtitle segments referenced by
//     #EXT-X-MEDIA TYPE=SUBTITLES alt renditions
//   - .aac / .ac3 → raw audio segments occasionally used as alt-audio
//     in #EXT-X-MEDIA renditions
//   - .cmfv / .cmfa → CMAF video/audio segments
// Other extensions stay refused (.txt, .html, .php, ...) because there
// is no legitimate HLS use case for them — letting them through would
// turn this endpoint into a generic open relay scoped to the camera's
// base URL. Path traversal (`..`) and absolute paths are rejected
// separately. This regex matches the PATH-ONLY portion; query strings
// are split off in `resolveSegmentTargetUrl` before validation.
const SEGMENT_FILENAME_PATTERN = /^[A-Za-z0-9_./-]+\.(ts|m4s|mp4|m3u8|key|bin|vtt|webvtt|aac|ac3|cmfv|cmfa)$/i;

// Query params that identify a per-VIEWER session rather than the segment
// content. Some upstreams (e.g. Diskominfo Bojonegoro) mint a fresh
// `?session=...` on EVERY playlist fetch and stamp it onto each segment URL,
// so the same immutable `_NNN.ts` bytes arrive under a different URL for each
// poll. Keying the segment cache by the full URL then makes the cache (and the
// Cloudflare edge) miss 100% of the time — every viewer, every poll, re-pulls
// the origin. Stripping these params from the *cache key* (NOT from the
// upstream fetch URL — the token is still required there) lets one fetch of a
// given segment serve all viewers.
//
// Deliberately conservative: only params that are reused VERBATIM across the
// segments of a single playlist belong here. Per-segment signed CDNs (Wowza
// `wmsAuthSign`, signed-URL CDNs) mint a DIFFERENT token per segment, so their
// token is part of the content identity and must stay in the key — those param
// names are intentionally absent from this default set.
const DEFAULT_CACHE_KEY_STRIP_PARAMS = ['session', 'sessionid', 'session_id', 'token'];

/**
 * Build the segment cache key. The token-bearing query params listed in
 * `stripParams` are removed from the key so rotating per-viewer session tokens
 * don't fragment the cache; every OTHER query param is preserved verbatim so
 * genuinely-distinct resources keep distinct keys. The upstream fetch still
 * uses the full `targetUrl` (with token) — only the KEY is normalised.
 */
export function buildSegmentCacheKey(cameraId, targetUrl, stripParams = DEFAULT_CACHE_KEY_STRIP_PARAMS) {
    let keyUrl = targetUrl;
    try {
        const parsed = new URL(targetUrl);
        let mutated = false;
        for (const param of stripParams) {
            if (parsed.searchParams.has(param)) {
                parsed.searchParams.delete(param);
                mutated = true;
            }
        }
        // Only rebuild when we actually removed something, so URLs without a
        // tracked token round-trip byte-for-byte (no surprise re-encoding).
        if (mutated) {
            keyUrl = parsed.toString();
        }
    } catch {
        // Non-absolute / unparseable target — fall back to the raw string.
        keyUrl = targetUrl;
    }
    return `${cameraId}|seg|${keyUrl}`;
}

// HLS directive tags whose `URI="..."` attribute references a resource
// the player will fetch (init segment, encryption key, alt rendition,
// I-frame variant playlist, LL-HLS partial/preload, rendition report).
// Without rewriting these, an upstream that embeds an ABSOLUTE gov URL
// inside one of these tags will leak the host into the browser — the
// player happily follows the absolute URL straight to the upstream,
// bypassing the opaque proxy and triggering a CORS block.
//
// Tags intentionally NOT here either carry no URI (#EXT-X-VERSION,
// #EXT-X-TARGETDURATION, #EXTINF, ...) or carry the URI on the NEXT
// LINE so the existing standalone-line rewriter already handles them
// (#EXT-X-STREAM-INF).
const DIRECTIVE_URI_TAGS = /^#EXT-X-(MAP|KEY|SESSION-KEY|MEDIA|I-FRAME-STREAM-INF|PART|PRELOAD-HINT|RENDITION-REPORT)\b/i;

function lookupExternalCamera(cameraId) {
    const parsed = Number.parseInt(cameraId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    try {
        return queryOne(
            `SELECT id, stream_source, external_hls_url,
                    COALESCE(external_use_proxy, 1) as external_use_proxy,
                    CASE
                        WHEN external_tls_mode IN ('strict', 'insecure') THEN external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode
             FROM cameras
             WHERE id = ?`,
            [parsed]
        );
    } catch (error) {
        console.error('[ExternalStreamProxy] camera lookup error:', error.message);
        return null;
    }
}

/**
 * Decide whether a camera is eligible for opaque proxying. Mirrors the
 * `external_use_proxy` flag — admins can disable proxying per camera
 * for direct-stream mode, in which case this endpoint refuses with 404
 * rather than silently bypassing the admin's choice.
 */
function isCameraProxyable(camera) {
    if (!camera) return false;
    if (camera.stream_source !== 'external') return false;
    if (!camera.external_hls_url) return false;
    if (camera.external_use_proxy === 0 || camera.external_use_proxy === false) return false;
    return true;
}

/**
 * Tenancy/billing gate for the external proxy entry points. Community
 * cameras pass untouched. owner_private/subscriber cameras require a
 * staff/owner JWT (cookie or Bearer) or a camera-bound stream token
 * (?token=), and subscriber-class additionally requires billing_status
 * 'active'. Opaque child-segment URLs do not carry ?token=, so tokened
 * viewers cover the master fetch only — portal players rely on the
 * same-origin JWT cookie, which rides on every request.
 *
 * Returns true when the request was denied (response already sent).
 */
function denyIfNotViewable(request, reply, cameraId) {
    const info = getAccessInfo(cameraId);
    if (!info) {
        return false;
    }
    // No community short-circuit: a community camera in a voucher-gated area must still pass the
    // gate. canViewLive returns voucherGated → flag the request so the onSend hook forces
    // private/no-store and the (otherwise edge-cacheable) segments never enter a shared cache.
    const access = canViewLive({
        info,
        user: resolveHlsViewerUser(request),
        streamToken: request.streamToken || null,
        voucherDeviceHash: readVoucherDeviceHash(request),
    });
    if (access.voucherGated) {
        request.voucherPrivate = true;
    }
    if (access.allowed) {
        return false;
    }
    reply.header('Cache-Control', 'no-store');
    reply.code(access.statusCode === 402 ? 402 : 403).send('');
    return true;
}

/**
 * Return the directory URL the camera's segments live under. Used to
 * resolve a segment filename back to an absolute upstream URL.
 *
 * `new URL('.', x)` is the standard JS trick to get the parent dir URL
 * without manual string slicing.
 */
function getCameraBaseUrl(camera) {
    try {
        return new URL('.', camera.external_hls_url).href;
    } catch {
        return null;
    }
}

/**
 * Strip an absolute or relative segment URL down to the path the m3u8
 * uses to address it. We then re-emit it as
 * `/api/stream/{cameraId}/external-segment/{encodedPath}` so clients
 * never see the upstream host.
 *
 * Important details:
 *   - The query string is preserved (URL-encoded into the opaque
 *     filename) because some upstreams sign their segment URLs
 *     (Wowza `wmsAuthSign`, signed CDNs, Shinobi monitor tokens) and
 *     stripping the query would make the upstream refuse the segment
 *     fetch with 401/403.
 *   - Cross-host segment URLs collapse to their last path component;
 *     the backend's `isExternalProxyUrlCompatible` will still refuse to
 *     fetch them at request time, so this only matters for shape.
 */
export function buildOpaqueSegmentUrl(cameraId, segmentLine, sourceUrl) {
    if (!segmentLine) return '';
    const trimmed = segmentLine.trim();
    let absolute = trimmed;
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        try {
            absolute = new URL(trimmed, sourceUrl).href;
        } catch {
            absolute = trimmed;
        }
    }

    // Use the path RELATIVE to the playlist's base URL when possible —
    // gives shorter, predictable opaque URLs for nested segments.
    let pathSuffix = '';
    let querySuffix = '';
    try {
        const parsed = new URL(absolute);
        const baseParsed = new URL('.', sourceUrl);
        // Same host check — refuse to emit an opaque URL for an
        // upstream that points outside the camera's own host.
        if (parsed.host === baseParsed.host && parsed.pathname.startsWith(baseParsed.pathname)) {
            pathSuffix = parsed.pathname.slice(baseParsed.pathname.length);
        } else {
            // Different host -> last path component only; backend will
            // still validate against the camera's base URL when proxying.
            pathSuffix = parsed.pathname.split('/').pop() || '';
        }
        // parsed.search includes the leading `?`. Tokenised CDNs and
        // Wowza wmsAuthSign servers ride along here and MUST survive
        // the round-trip — without the token the upstream refuses the
        // segment fetch.
        querySuffix = parsed.search || '';
    } catch {
        pathSuffix = absolute.split('/').pop() || '';
    }

    if (!pathSuffix) return '';
    // encodeURIComponent escapes `?`, `&`, `=` etc., so the entire
    // path+query string round-trips safely through Fastify's `:filename`
    // path-parameter without spilling into the routing layer.
    return `/api/stream/${cameraId}/external-segment/${encodeURIComponent(pathSuffix + querySuffix)}`;
}

/**
 * Rewrite every URI a player will fetch (standalone segment lines AND
 * URI="..." attributes inside directive tags like #EXT-X-MAP,
 * #EXT-X-KEY, #EXT-X-MEDIA) to opaque `/api/stream/.../external-segment`
 * paths.
 *
 * The directive-URI rewrite is critical for any upstream that emits
 * ABSOLUTE upstream URLs inside these tags. Without it the player
 * happily follows the absolute URL straight to the gov host,
 * triggering a CORS block in production and leaking the camera's
 * source URL into the browser's network panel. Same-line-as-#
 * directives that carry their URI on the FOLLOWING line
 * (#EXT-X-STREAM-INF) are already covered by the standalone-line
 * branch.
 */
export function rewriteOpaquePlaylist(playlistText, sourceUrl, cameraId) {
    const lines = String(playlistText || '').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const line = rawLine.trim();
        if (!line) continue;

        if (line.startsWith('#')) {
            if (DIRECTIVE_URI_TAGS.test(line)) {
                lines[index] = rewriteDirectiveUris(rawLine, sourceUrl, cameraId);
            }
            continue;
        }

        const opaque = buildOpaqueSegmentUrl(cameraId, line, sourceUrl);
        if (opaque) {
            lines[index] = opaque;
        }
    }
    return lines.join('\n');
}

/**
 * Replace every `URI="..."` attribute on an HLS directive line with
 * an opaque proxy URL. Per the HLS spec, attribute values are always
 * double-quoted, so a precise regex is enough here — no need to invoke
 * an attribute-list parser.
 *
 * If buildOpaqueSegmentUrl returns an empty string (cross-host segment
 * with no addressable path), the original URI is preserved untouched.
 * The backend's segment handler will refuse such a fetch at request
 * time, but leaving the original means HLS.js's own error path runs
 * instead of producing a malformed playlist.
 */
function rewriteDirectiveUris(directiveLine, sourceUrl, cameraId) {
    return directiveLine.replace(/URI="([^"]+)"/g, (match, uri) => {
        const opaque = buildOpaqueSegmentUrl(cameraId, uri, sourceUrl);
        return opaque ? `URI="${opaque}"` : match;
    });
}

/**
 * Validate a segment filename + reconstruct the absolute upstream URL.
 * Returns null on any failure — caller must reply with 400.
 *
 * Defence-in-depth checks:
 *   1. Whitelist regex on the (decoded) filename.
 *   2. No `..` segments.
 *   3. Final URL host/protocol/path must satisfy
 *      isExternalProxyUrlCompatible against the camera's stored URL.
 *      That is the SAME check the legacy /hls/proxy route already
 *      relies on, so the security surface here matches.
 *   4. Optional global allowlist (config.security.hls.externalProxyAllowedHosts).
 */
export function resolveSegmentTargetUrl(camera, rawFilename, allowOptions) {
    if (!camera || !rawFilename) return null;

    let filename;
    try {
        filename = decodeURIComponent(String(rawFilename));
    } catch {
        return null;
    }

    // Split path vs. query/fragment. The strict whitelist regex below
    // applies only to the PATH part — the query is preserved verbatim
    // and re-attached to the upstream URL because some sources sign
    // their segment URLs (Wowza wmsAuthSign, signed CDNs).
    const queryIndex = filename.search(/[?#]/);
    const pathPart = queryIndex >= 0 ? filename.slice(0, queryIndex) : filename;
    const querySuffix = queryIndex >= 0 ? filename.slice(queryIndex) : '';

    if (!SEGMENT_FILENAME_PATTERN.test(pathPart)) return null;
    if (pathPart.includes('..')) return null;
    if (pathPart.startsWith('/')) return null;

    const baseUrl = getCameraBaseUrl(camera);
    if (!baseUrl) return null;

    const targetUrl = baseUrl + pathPart + querySuffix;
    if (!isExternalProxyUrlCompatible(camera.external_hls_url, targetUrl)) {
        return null;
    }
    if (!isExternalProxyTargetAllowed(targetUrl, allowOptions)) {
        return null;
    }
    return targetUrl;
}

function pickHttpClient({ tlsMode, baseClient, timeout }) {
    if (tlsMode !== 'insecure') return baseClient;
    return createHlsHttpClient(timeout, {
        httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
}

// HLS playlist content type — used to distinguish a small frequently-
// changing m3u8 body (must NOT be edge-cached, even if it cost a few
// extra origin hits) from an immutable media segment that SHOULD be
// edge-cached so a popular camera doesn't bombard the origin.
const PLAYLIST_CONTENT_TYPE = 'application/vnd.apple.mpegurl';

// Edge cache window for IMMUTABLE media segments. HLS segments never
// change content once published — same opaque URL ⇒ same bytes — so
// caching aggressively at Cloudflare's edge is safe and removes the
// origin from the hot path for popular cameras. 60s matches the
// in-memory segmentCache TTL above; longer doesn't help because the
// upstream playlist sliding window will have rotated the segment out
// of the live edge by then anyway.
const SEGMENT_EDGE_TTL_SECONDS = 60;
const SEGMENT_CACHE_CONTROL = `public, max-age=${SEGMENT_EDGE_TTL_SECONDS}, s-maxage=${SEGMENT_EDGE_TTL_SECONDS}, immutable`;
// Playlists rotate every few seconds — keep them per-viewer fresh.
const PLAYLIST_CACHE_CONTROL = 'no-cache, no-store, must-revalidate';

function applyResponseCacheHeaders(reply, contentType) {
    reply.header('Content-Type', contentType);
    if (contentType === PLAYLIST_CONTENT_TYPE) {
        reply.header('Cache-Control', PLAYLIST_CACHE_CONTROL);
        reply.header('Pragma', 'no-cache');
        reply.header('Expires', '0');
    } else {
        // Edge-cacheable: Cloudflare honors `s-maxage` regardless of the
        // surrounding `no-store`-leaning cache rules we set on auth
        // endpoints. Browser also caches for the same window so an
        // individual viewer never refetches the same chunk twice.
        reply.header('Cache-Control', SEGMENT_CACHE_CONTROL);
    }
}

function sendCachedResponse(reply, cached) {
    applyResponseCacheHeaders(reply, cached.contentType);
    reply.header('X-RAFNET-Proxy-Cache', 'HIT');
    if (Buffer.isBuffer(cached.body)) {
        reply.header('Content-Length', String(cached.byteSize));
    }
    return reply.send(cached.body);
}

export async function registerExternalStreamProxyRoutes(fastify, options = {}) {
    const hlsConfig = config.security?.hls || {};
    const timeout = options.timeout
        || hlsConfig.externalProxyTimeoutMs
        || DEFAULT_TIMEOUT_MS;
    const allowOptions = {
        allowPrivateHosts: options.allowPrivateHosts
            ?? hlsConfig.externalProxyAllowPrivateHosts
            ?? false,
        allowedHosts: options.allowedHosts
            ?? hlsConfig.externalProxyAllowedHosts
            ?? [],
    };

    // Caches isolated from /hls/proxy's caches by default — both old and
    // new endpoints can run side-by-side without sharing cache rows that
    // were keyed under different conventions. Tests inject mocks via
    // options to assert hit/miss counts cleanly.
    const playlistCache = options.playlistCache || createPlaylistCache();
    const segmentCache = options.segmentCache || createSegmentCache();
    const baseClient = options.httpClient || createHlsHttpClient(timeout);

    // Query params stripped from the SEGMENT cache key so rotating per-viewer
    // session tokens (e.g. Bojonegoro's `?session=`) don't fragment the cache.
    // The token is still sent upstream — only the key is normalised. See
    // buildSegmentCacheKey + DEFAULT_CACHE_KEY_STRIP_PARAMS.
    const cacheKeyStripParams = options.cacheKeyStripParams
        ?? hlsConfig.externalProxyCacheKeyStripParams
        ?? DEFAULT_CACHE_KEY_STRIP_PARAMS;

    // Per-camera row cache. The opaque routes resolve the camera from the DB on
    // EVERY playlist AND segment request (lookupExternalCamera). For a busy
    // external camera with 2s segments that's ~30 synchronous SQLite reads per
    // minute per viewer — pure overhead, since external_hls_url / proxy / tls
    // mode change only when an admin edits the camera. The legacy /hls/* route
    // already cached the camera id for 5 min; this restores parity for the
    // opaque route with a short TTL so admin edits still take effect quickly.
    // Negative lookups are cached briefly too, so a bad/probed id can't hammer
    // the DB while still recovering fast once the camera appears.
    const cameraCache = options.cameraCache || new Map();
    const cameraCacheTtlMs = options.cameraCacheTtlMs ?? 30000;
    const cameraNegativeCacheTtlMs = options.cameraNegativeCacheTtlMs ?? 5000;

    function getCameraCached(cameraId) {
        const key = String(cameraId);
        const now = Date.now();
        const cached = cameraCache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.camera;
        }
        const camera = lookupExternalCamera(cameraId);
        cameraCache.set(key, {
            camera,
            expiresAt: now + (camera ? cameraCacheTtlMs : cameraNegativeCacheTtlMs),
        });
        return camera;
    }

    // Master-playlist stale-while-revalidate store.
    //
    // The master is the single entry point for an external_hls stream, it is
    // tiny (one variant line + a long-lived session token), and the
    // Bojonegoro-class origin returns 500 on it ~5-10% of the time (measured) —
    // a transient race when it mints the session token. A cold fetch that hits
    // that blip used to fail the WHOLE stream for the viewer.
    //
    // This is a DEDICATED store, not the shared TTL playlistCache, on purpose:
    // playlistCache.get() deletes an entry the moment it expires, so it can
    // never back a stale fallback (the prior "stale" branch here was dead code).
    // Here we keep the last good master and serve it:
    //   - age < MASTER_FRESH_MS  -> serve as-is, no upstream contact
    //   - age < MASTER_STALE_MS  -> serve immediately, revalidate in background
    //   - older / absent         -> fetch now (with retry); on failure fall back
    //                               to any copy we still hold, else passthrough
    // The session token survives idle for tens of seconds (measured >32s) and
    // the background refresh keeps it fresh, so a stale master still points at a
    // fetchable child playlist. refreshMaster is deduped per camera so N viewers
    // trigger at most ONE upstream refresh in flight.
    const lastGoodMaster = options.lastGoodMaster || new Map(); // cameraId -> { body, contentType, storedAt }
    const masterRefreshInflight = new Map(); // cameraId -> Promise
    const MASTER_FRESH_MS = options.masterFreshMs ?? EXTERNAL_CACHE_TTL.PLAYLIST_MS;
    const MASTER_STALE_MS = options.masterStaleMs ?? 60000;

    // In-flight de-duplication for segments and child playlists. When N viewers
    // request the SAME live segment/child within the cold-fetch window (cache
    // miss, e.g. a freshly-rotated segment), without this each viewer fires its
    // own upstream fetch — N origin hits + N buffers in RAM (a thundering herd
    // that hits hardest exactly when a camera is popular). Keyed by the cache
    // key, so concurrent callers share ONE upstream fetch and one buffer; the
    // result is cached, so requests after it resolves are plain cache hits.
    const segmentFetchInflight = new Map(); // cacheKey -> Promise<{status, contentType?, body?}>
    const childFetchInflight = new Map();   // playlistCacheKey -> Promise<{status, contentType?, body?}>

    async function refreshMaster(camera) {
        const existing = masterRefreshInflight.get(camera.id);
        if (existing) return existing;

        const promise = (async () => {
            const httpClient = pickHttpClient({
                tlsMode: camera.external_tls_mode,
                baseClient,
                timeout,
            });
            const response = await fetchTextUpstreamWithRetry({
                httpClient,
                targetUrl: camera.external_hls_url,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Encoding': 'identity',
                },
                maxContentLength: hlsConfig.maxExternalPlaylistBytes,
                maxBodyLength: hlsConfig.maxExternalPlaylistBytes,
            });
            if (response.status !== 200) {
                const error = new Error(`master upstream status ${response.status}`);
                error.statusCode = response.status;
                throw error;
            }
            const rewritten = rewriteOpaquePlaylist(response.data, camera.external_hls_url, camera.id);
            lastGoodMaster.set(camera.id, {
                body: rewritten,
                contentType: PLAYLIST_CONTENT_TYPE,
                storedAt: Date.now(),
            });
            cameraHealthService.recordRuntimeSignal(camera.id, {
                targetUrl: camera.external_hls_url,
                signalType: 'external_hls_playlist_proxy',
                success: true,
            });
            return rewritten;
        })().finally(() => masterRefreshInflight.delete(camera.id));

        masterRefreshInflight.set(camera.id, promise);
        return promise;
    }

    // Fetch a child playlist once for all concurrent callers of the same URL.
    // Returns { status, contentType?, body? }. On 200 the rewritten body is
    // cached; non-200 returns the status so the caller runs its stale fallback.
    function fetchChildPlaylistDeduped(camera, targetUrl, playlistCacheKey) {
        const existing = childFetchInflight.get(playlistCacheKey);
        if (existing) return existing;

        const promise = (async () => {
            const httpClient = pickHttpClient({ tlsMode: camera.external_tls_mode, baseClient, timeout });
            const response = await fetchTextUpstreamWithRetry({
                httpClient,
                targetUrl,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Encoding': 'identity',
                },
                maxContentLength: hlsConfig.maxExternalPlaylistBytes,
                maxBodyLength: hlsConfig.maxExternalPlaylistBytes,
            });
            if (response.status !== 200) {
                return { status: response.status };
            }
            // Pass the CHILD playlist's URL as sourceUrl so segment entries
            // resolve relative to the child's directory (may differ from master).
            const rewritten = rewriteOpaquePlaylist(response.data, targetUrl, camera.id);
            playlistCache.set(
                playlistCacheKey,
                { statusCode: 200, contentType: PLAYLIST_CONTENT_TYPE, body: rewritten },
                EXTERNAL_CACHE_TTL.PLAYLIST_MS
            );
            cameraHealthService.recordRuntimeSignal(camera.id, {
                targetUrl,
                signalType: 'external_hls_playlist_proxy',
                success: true,
            });
            return { status: 200, contentType: PLAYLIST_CONTENT_TYPE, body: rewritten };
        })().finally(() => childFetchInflight.delete(playlistCacheKey));

        childFetchInflight.set(playlistCacheKey, promise);
        return promise;
    }

    // Fetch a binary segment once for all concurrent callers of the same key.
    // Returns { status, contentType?, body? }. On 200 the buffer is cached.
    function fetchSegmentDeduped(camera, targetUrl, targetPath, cacheKey) {
        const existing = segmentFetchInflight.get(cacheKey);
        if (existing) return existing;

        const promise = (async () => {
            const httpClient = pickHttpClient({ tlsMode: camera.external_tls_mode, baseClient, timeout });
            const { controller, response, data } = await fetchBufferedBinaryUpstream({
                httpClient,
                targetUrl,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept-Encoding': 'identity',
                },
                maxRetries: 3,
            });
            if (response.status !== 200) {
                safeAbort(controller);
                return { status: response.status };
            }
            // Detect content-type from the path part only — auth tokens in the
            // query string can contain `.ts`/`.mp4` substrings that would
            // otherwise misclassify the response.
            let contentType = 'application/octet-stream';
            if (targetPath.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (targetPath.endsWith('.mp4') || targetPath.endsWith('.m4s')) {
                contentType = 'video/mp4';
            } else if (targetPath.endsWith('.vtt') || targetPath.endsWith('.webvtt')) {
                contentType = 'text/vtt';
            }
            segmentCache.set(
                cacheKey,
                { statusCode: 200, contentType, body: data },
                EXTERNAL_CACHE_TTL.SEGMENT_MS
            );
            cameraHealthService.recordRuntimeSignal(camera.id, {
                targetUrl,
                signalType: 'external_hls_segment_proxy',
                success: true,
            });
            safeAbort(controller);
            return { status: 200, contentType, body: data };
        })().finally(() => segmentFetchInflight.delete(cacheKey));

        segmentFetchInflight.set(cacheKey, promise);
        return promise;
    }

    // Viewer-session tracking state. Shares the same HlsSessionStore +
    // FixedWindowLimiter shape as the legacy /hls/proxy + internal /hls/*
    // routes, so external_hls cameras get the SAME live/lifetime view
    // counters that internal cameras already enjoyed. Tests can inject a
    // shared state via `options.routeState` to keep session entries
    // visible from outside the plugin.
    const ownRouteState = !options.routeState;
    const routeState = options.routeState || createHlsRouteState();
    if (ownRouteState) {
        routeState.start();
    }

    /**
     * Attach the viewer-session heartbeat to a request without
     * blocking the response if it fails. Playlist fetches create OR
     * heartbeat the dedupe entry for this (identity, cameraId); segment
     * fetches only heartbeat (no new sessions on segment hits, otherwise
     * a 1000-segment view inflates the session count).
     *
     * Returns void — failures are logged but never propagate to the
     * client. The HLS player must not see session bookkeeping errors.
     */
    async function trackViewerHeartbeat(request, cameraId, kind) {
        if (!cameraId) return;
        const identity = routeState.getViewerIdentity(request);
        if (!identity || identity === 'unknown') return;
        try {
            if (kind === 'playlist') {
                await routeState.getOrCreateSession(identity, cameraId, request);
            } else {
                await routeState.recordSegmentAccess(identity, cameraId);
            }
        } catch (error) {
            // Don't crash the proxy because the view counter hiccuped.
            console.error(`[ExternalStreamProxy] viewer session ${kind} error camera=${cameraId}:`, error.message);
        }
    }

    fastify.addHook('onClose', async () => {
        playlistCache.clear();
        segmentCache.clear();
        cameraCache.clear();
        lastGoodMaster.clear();
        masterRefreshInflight.clear();
        segmentFetchInflight.clear();
        childFetchInflight.clear();
        if (ownRouteState) {
            // Drain any pending session closes before tearing down so we
            // don't leak open sessions on a graceful restart.
            await routeState.stop();
        }
    });

    // GET /api/stream/:cameraId/external.m3u8
    fastify.get('/:cameraId/external.m3u8', { preHandler: verifyStreamToken }, async (request, reply) => {
        const camera = getCameraCached(request.params.cameraId);
        if (!isCameraProxyable(camera)) {
            return reply.code(404).send('Camera not found or not proxyable');
        }

        if (denyIfNotViewable(request, reply, camera.id)) {
            return reply;
        }

        if (!isExternalProxyTargetAllowed(camera.external_hls_url, allowOptions)) {
            return reply.code(400).send('Camera external URL not allowed');
        }

        // Track viewer session BEFORE the cache check. The player
        // refetches the master playlist every ~3s (HLS spec), so this
        // is the heartbeat that keeps the session row alive. Each call
        // is deduped by (identity, cameraId) inside HlsSessionStore —
        // it does NOT create a new session per fetch.
        await trackViewerHeartbeat(request, camera.id, 'playlist');

        // Stale-while-revalidate on the master. See the lastGoodMaster comment
        // above for why the master gets this treatment (it is the single entry
        // point, tiny, and the origin 500s on it ~5-10% of the time — a cold
        // fetch that hits that blip used to fail the whole stream).
        const now = Date.now();
        const good = lastGoodMaster.get(camera.id);
        const ageMs = good ? now - good.storedAt : Infinity;

        // 1. Fresh enough — serve as-is, never touch the origin.
        if (good && ageMs < MASTER_FRESH_MS) {
            applyResponseCacheHeaders(reply, good.contentType);
            reply.header('X-RAFNET-Proxy-Cache', 'HIT');
            return reply.send(good.body);
        }

        // 2. Stale but usable — serve instantly, revalidate in the background.
        //    The origin's 5xx blips never reach the viewer in this path.
        if (good && ageMs < MASTER_STALE_MS) {
            void refreshMaster(camera).catch((error) => {
                console.error(`[ExternalStreamProxy] master background refresh camera=${camera.id}:`, error.message);
            });
            applyResponseCacheHeaders(reply, good.contentType);
            reply.header('X-RAFNET-Proxy-Cache', 'STALE-REVALIDATE');
            return reply.send(good.body);
        }

        // 3. Cold (first viewer / server just started) or too stale — fetch now
        //    with retry. On total failure, fall back to any copy we still hold;
        //    only a truly cold failure reaches the client.
        try {
            const body = await refreshMaster(camera);
            applyResponseCacheHeaders(reply, PLAYLIST_CONTENT_TYPE);
            reply.header('X-RAFNET-Proxy-Cache', 'MISS');
            return reply.send(body);
        } catch (error) {
            console.error(`[ExternalStreamProxy] playlist error camera=${camera.id}:`, error.message);
            if (good) {
                applyResponseCacheHeaders(reply, good.contentType);
                reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                cameraHealthService.recordRuntimeSignal(camera.id, {
                    targetUrl: camera.external_hls_url,
                    signalType: 'external_hls_playlist_proxy_stale',
                    success: false,
                });
                return reply.send(good.body);
            }
            const status = Number.isInteger(error?.statusCode) && error.statusCode >= 400
                ? error.statusCode
                : 502;
            reply.header('Content-Type', 'text/plain');
            reply.header('Cache-Control', 'no-cache');
            return reply.code(status).send('');
        }
    });

    // GET /api/stream/:cameraId/external-segment/:filename
    fastify.get('/:cameraId/external-segment/:filename', { preHandler: verifyStreamToken }, async (request, reply) => {
        const camera = getCameraCached(request.params.cameraId);
        if (!isCameraProxyable(camera)) {
            return reply.code(404).send('Camera not found or not proxyable');
        }

        if (denyIfNotViewable(request, reply, camera.id)) {
            return reply;
        }

        const targetUrl = resolveSegmentTargetUrl(camera, request.params.filename, allowOptions);
        if (!targetUrl) {
            return reply.code(400).send('Invalid segment filename');
        }

        // Master playlists reference variant CHILD playlists by URL —
        // those flow back through this same endpoint after rewriting.
        // When the resolved target is itself an .m3u8, fetch as text,
        // rewrite its segment lines (which use this same opaque scheme),
        // and serve as a playlist. The body is cached in playlistCache
        // with a short TTL so live playlists stay fresh.
        //
        // Inspect the path part only — query string (auth tokens like
        // ?wmsAuthSign=...) must not flip the classification.
        const targetPath = targetUrl.split('?')[0].toLowerCase();
        const isPlaylistTarget = targetPath.endsWith('.m3u8');

        // Viewer-session heartbeat. Child playlists count as `playlist`
        // (they re-arm the dedupe entry like the master), while binary
        // segments count as `segment` (heartbeat only — no new session
        // rows). Skipped for cache hits below would NOT keep the session
        // alive, so we run it BEFORE the cache short-circuit.
        await trackViewerHeartbeat(request, camera.id, isPlaylistTarget ? 'playlist' : 'segment');
        if (isPlaylistTarget) {
            const playlistCacheKey = `${camera.id}|nested|${targetUrl}`;
            const cachedPlaylist = playlistCache.get(playlistCacheKey);
            if (cachedPlaylist) {
                return sendCachedResponse(reply, cachedPlaylist);
            }

            try {
                // De-duped: concurrent viewers of the same child playlist share
                // one upstream fetch (the retry helper absorbs origin 5xx blips).
                const result = await fetchChildPlaylistDeduped(camera, targetUrl, playlistCacheKey);

                if (result.status !== 200) {
                    // Stale-cache fallback — child playlists are where flaky
                    // upstreams hurt most (polled every ~2s).
                    const stalePlaylist = playlistCache.getStale(playlistCacheKey);
                    if (stalePlaylist) {
                        applyResponseCacheHeaders(reply, stalePlaylist.contentType);
                        reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                        cameraHealthService.recordRuntimeSignal(camera.id, {
                            targetUrl,
                            signalType: 'external_hls_playlist_proxy_stale',
                            success: false,
                        });
                        return reply.send(stalePlaylist.body);
                    }
                    reply.header('Content-Type', 'text/plain');
                    reply.header('Cache-Control', 'no-cache');
                    return reply.code(result.status).send('');
                }

                applyResponseCacheHeaders(reply, result.contentType);
                reply.header('X-RAFNET-Proxy-Cache', 'MISS');
                return reply.send(result.body);
            } catch (error) {
                console.error(`[ExternalStreamProxy] child playlist error camera=${camera.id} url=${targetUrl}:`, error.message);
                // Network / timeout fallback for the child playlist.
                const stalePlaylist = playlistCache.getStale(playlistCacheKey);
                if (stalePlaylist) {
                    applyResponseCacheHeaders(reply, stalePlaylist.contentType);
                    reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                    return reply.send(stalePlaylist.body);
                }
                return reply.code(502).send('');
            }
        }

        const cacheKey = buildSegmentCacheKey(camera.id, targetUrl, cacheKeyStripParams);
        const cached = segmentCache.get(cacheKey);
        if (cached) {
            return sendCachedResponse(reply, cached);
        }

        try {
            // De-duped: N concurrent viewers of the same freshly-rotated segment
            // share ONE upstream fetch + one RAM buffer instead of a thundering
            // herd of N origin pulls. The result is cached, so any request that
            // arrives after it resolves is a plain cache hit.
            const result = await fetchSegmentDeduped(camera, targetUrl, targetPath, cacheKey);

            if (result.status !== 200) {
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(result.status).send('');
            }

            // Edge-cacheable Cache-Control headers (set in applyResponseCacheHeaders):
            // the opaque URL is deterministic per upstream segment, so once a
            // Cloudflare Cache Rule is enabled for /external-segment/* the edge
            // serves repeat viewers without ever touching this origin.
            applyResponseCacheHeaders(reply, result.contentType);
            reply.header('Content-Length', String(result.body.length));
            reply.header('X-RAFNET-Proxy-Cache', 'MISS');
            return reply.send(result.body);
        } catch (error) {
            console.error(`[ExternalStreamProxy] segment error camera=${camera.id} url=${targetUrl}:`, error.message);
            return reply.code(502).send('');
        }
    });
}
