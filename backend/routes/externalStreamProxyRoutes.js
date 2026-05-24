/*
Purpose: Opaque external-HLS proxy routes — mount external CCTV streams under /api/stream/:id/external.* so the source URL never leaves the backend.
Caller: backend/server.js, registered alongside streamRoutes under the /api/stream prefix.
Deps: connectionPool (camera lookup), cameraHealthService (runtime signals), externalStreamCache, hlsProxyRoutes (shared fetch + validator helpers).
MainFuncs: externalStreamProxyRoutes (default export), buildOpaqueSegmentUrl, rewriteOpaquePlaylist, resolveSegmentTargetUrl.
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
import {
    createPlaylistCache,
    createSegmentCache,
    TTL as EXTERNAL_CACHE_TTL,
} from '../services/externalStreamCache.js';
import {
    fetchTextUpstream,
    fetchBufferedBinaryUpstream,
    isExternalProxyTargetAllowed,
    isExternalProxyUrlCompatible,
    createHlsHttpClient,
    safeAbort,
} from './hlsProxyRoutes.js';
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

function sendCachedResponse(reply, cached) {
    reply.header('Content-Type', cached.contentType);
    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');
    reply.header('X-RAFNET-Proxy-Cache', 'HIT');
    if (Buffer.isBuffer(cached.body)) {
        reply.header('Content-Length', String(cached.byteSize));
    }
    return reply.send(cached.body);
}

export default async function externalStreamProxyRoutes(fastify, options = {}) {
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

    fastify.addHook('onClose', async () => {
        playlistCache.clear();
        segmentCache.clear();
    });

    // GET /api/stream/:cameraId/external.m3u8
    fastify.get('/:cameraId/external.m3u8', async (request, reply) => {
        const camera = lookupExternalCamera(request.params.cameraId);
        if (!isCameraProxyable(camera)) {
            return reply.code(404).send('Camera not found or not proxyable');
        }

        if (!isExternalProxyTargetAllowed(camera.external_hls_url, allowOptions)) {
            return reply.code(400).send('Camera external URL not allowed');
        }

        const cacheKey = `${camera.id}|playlist`;
        const cached = playlistCache.get(cacheKey);
        if (cached) {
            return sendCachedResponse(reply, cached);
        }

        try {
            const httpClient = pickHttpClient({
                tlsMode: camera.external_tls_mode,
                baseClient,
                timeout,
            });
            const response = await fetchTextUpstream({
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
                // Stale-cache fallback. Pemda / gov HLS upstreams 5xx
                // sporadically for 1–3 seconds at a time. Without this,
                // the player gets a 500 response, retries 5x (each one
                // also hitting the flaky upstream), and gives up with a
                // misleading "CORS error" toast. By serving a slightly
                // stale rewritten playlist body we cover the blink and
                // the player walks through it.
                const stale = playlistCache.getStale(cacheKey);
                if (stale) {
                    reply.header('Content-Type', stale.contentType);
                    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                    reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                    cameraHealthService.recordRuntimeSignal(camera.id, {
                        targetUrl: camera.external_hls_url,
                        signalType: 'external_hls_playlist_proxy_stale',
                        success: false,
                    });
                    return reply.send(stale.body);
                }
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            const rewritten = rewriteOpaquePlaylist(response.data, camera.external_hls_url, camera.id);
            const contentType = 'application/vnd.apple.mpegurl';

            playlistCache.set(
                cacheKey,
                { statusCode: 200, contentType, body: rewritten },
                EXTERNAL_CACHE_TTL.PLAYLIST_MS
            );

            cameraHealthService.recordRuntimeSignal(camera.id, {
                targetUrl: camera.external_hls_url,
                signalType: 'external_hls_playlist_proxy',
                success: true,
            });

            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            reply.header('X-RAFNET-Proxy-Cache', 'MISS');
            return reply.send(rewritten);
        } catch (error) {
            console.error(`[ExternalStreamProxy] playlist error camera=${camera.id}:`, error.message);
            // Same stale-cache fallback for network / timeout errors —
            // these are even more transient than the 5xx case above.
            const stale = playlistCache.getStale(cacheKey);
            if (stale) {
                reply.header('Content-Type', stale.contentType);
                reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                return reply.send(stale.body);
            }
            return reply.code(502).send('');
        }
    });

    // GET /api/stream/:cameraId/external-segment/:filename
    fastify.get('/:cameraId/external-segment/:filename', async (request, reply) => {
        const camera = lookupExternalCamera(request.params.cameraId);
        if (!isCameraProxyable(camera)) {
            return reply.code(404).send('Camera not found or not proxyable');
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
        if (isPlaylistTarget) {
            const playlistCacheKey = `${camera.id}|nested|${targetUrl}`;
            const cachedPlaylist = playlistCache.get(playlistCacheKey);
            if (cachedPlaylist) {
                return sendCachedResponse(reply, cachedPlaylist);
            }

            try {
                const httpClient = pickHttpClient({
                    tlsMode: camera.external_tls_mode,
                    baseClient,
                    timeout,
                });
                const response = await fetchTextUpstream({
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
                    // Same stale-cache fallback as the master endpoint —
                    // child playlists are the layer where flaky upstreams
                    // hurt the most (5x retries each → 5x upstream hits).
                    const stalePlaylist = playlistCache.getStale(playlistCacheKey);
                    if (stalePlaylist) {
                        reply.header('Content-Type', stalePlaylist.contentType);
                        reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
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
                    return reply.code(response.status).send('');
                }

                // Pass the CHILD playlist's URL as sourceUrl so segment
                // entries inside resolve relative to the child's directory
                // (which may differ from the master's).
                const rewritten = rewriteOpaquePlaylist(response.data, targetUrl, camera.id);
                const contentType = 'application/vnd.apple.mpegurl';
                playlistCache.set(
                    playlistCacheKey,
                    { statusCode: 200, contentType, body: rewritten },
                    EXTERNAL_CACHE_TTL.PLAYLIST_MS
                );

                cameraHealthService.recordRuntimeSignal(camera.id, {
                    targetUrl,
                    signalType: 'external_hls_playlist_proxy',
                    success: true,
                });

                reply.header('Content-Type', contentType);
                reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                reply.header('Pragma', 'no-cache');
                reply.header('Expires', '0');
                reply.header('X-RAFNET-Proxy-Cache', 'MISS');
                return reply.send(rewritten);
            } catch (error) {
                console.error(`[ExternalStreamProxy] child playlist error camera=${camera.id} url=${targetUrl}:`, error.message);
                // Network / timeout fallback for the child playlist.
                const stalePlaylist = playlistCache.getStale(playlistCacheKey);
                if (stalePlaylist) {
                    reply.header('Content-Type', stalePlaylist.contentType);
                    reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                    reply.header('X-RAFNET-Proxy-Cache', 'STALE');
                    return reply.send(stalePlaylist.body);
                }
                return reply.code(502).send('');
            }
        }

        const cacheKey = `${camera.id}|seg|${targetUrl}`;
        const cached = segmentCache.get(cacheKey);
        if (cached) {
            return sendCachedResponse(reply, cached);
        }

        try {
            const httpClient = pickHttpClient({
                tlsMode: camera.external_tls_mode,
                baseClient,
                timeout,
            });
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
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            // Detect content-type from the path part only — auth tokens
            // in the query string can contain arbitrary substrings,
            // including `.ts` / `.mp4`, that would otherwise misclassify
            // a non-media response.
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

            reply.header('Content-Type', contentType);
            reply.header('Cache-Control', 'no-cache, no-store, must-revalidate');
            reply.header('Pragma', 'no-cache');
            reply.header('Expires', '0');
            reply.header('Content-Length', String(data.length));
            reply.header('X-RAFNET-Proxy-Cache', 'MISS');
            safeAbort(controller);
            return reply.send(data);
        } catch (error) {
            console.error(`[ExternalStreamProxy] segment error camera=${camera.id} url=${targetUrl}:`, error.message);
            return reply.code(502).send('');
        }
    });
}
