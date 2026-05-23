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
// Whitelist of file extensions allowed in the opaque `/external-segment`
// path. `.m3u8` is included because a master playlist's entries are
// themselves CHILD playlists (variant streams) — those URLs flow through
// the same opaque-segment endpoint after rewriteOpaquePlaylist rewrites
// them. The handler branches on extension below: `.m3u8` is fetched and
// rewritten as text; the rest are streamed as binary media. Path
// traversal (`..`) and absolute paths are rejected separately.
const SEGMENT_FILENAME_PATTERN = /^[A-Za-z0-9_./-]+\.(ts|m4s|mp4|m3u8)$/;

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
    } catch {
        pathSuffix = absolute.split('/').pop() || '';
    }

    if (!pathSuffix) return '';
    return `/api/stream/${cameraId}/external-segment/${encodeURIComponent(pathSuffix)}`;
}

/**
 * Build the new opaque playlist body from the upstream m3u8 text.
 * Same shape as rewriteExternalPlaylist in hlsProxyRoutes — but the
 * output URLs are opaque, not /hls/proxy?url=... style.
 */
export function rewriteOpaquePlaylist(playlistText, sourceUrl, cameraId) {
    const lines = String(playlistText || '').split('\n');
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index].trim();
        if (!line || line.startsWith('#')) continue;
        const opaque = buildOpaqueSegmentUrl(cameraId, line, sourceUrl);
        if (opaque) {
            lines[index] = opaque;
        }
    }
    return lines.join('\n');
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

    if (!SEGMENT_FILENAME_PATTERN.test(filename)) return null;
    if (filename.includes('..')) return null;
    if (filename.startsWith('/')) return null;

    const baseUrl = getCameraBaseUrl(camera);
    if (!baseUrl) return null;

    const targetUrl = baseUrl + filename;
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
        const isPlaylistTarget = targetUrl.toLowerCase().endsWith('.m3u8');
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

            let contentType = 'application/octet-stream';
            if (targetUrl.includes('.ts')) {
                contentType = 'video/mp2t';
            } else if (targetUrl.includes('.mp4') || targetUrl.includes('.m4s')) {
                contentType = 'video/mp4';
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
