/**
 * Purpose: Thin HLS proxy route layer — wires /hls/* (and /proxy) endpoints to the proxy/session/
 *          cache logic in services/hlsProxyService.js. No business logic lives in this file.
 * Caller: backend/server.js route registration for `/hls/*`.
 * Deps: config, cameraHealthService, hlsProxyService (state factory + fetch/cache/cors helpers).
 * MainFuncs: hlsProxyRoutes (default export).
 * SideEffects: Registers fastify routes; delegates all proxying/session work to hlsProxyService.
 */

import { config } from '../config/config.js';
import cameraHealthService from '../services/cameraHealthService.js';
import {
    createHlsRouteState,
    applyHlsCorsHeaders,
    handleExternalStreamProxy,
    verifyStreamToken,
    fetchTextUpstream,
    applyLegacyCacheHeaders,
    fetchBinaryUpstream,
    cleanupUpstreamResponse,
    attachAbortCleanup,
    resolveHlsViewerUser,
    propagateTokenInPlaylist,
} from '../services/hlsProxyService.js';
import { isTrustedStreamRequest } from '../services/streamHotlinkPolicy.js';
import {
    getAccessInfo,
    getAccessInfoByStreamKey,
    canViewLive,
} from '../services/cameraAccessService.js';
import { readVoucherDeviceHash } from '../services/voucherPass.js';

// Resolve tenancy info for an /hls path segment: UUID stream keys hit the
// stream_key index; legacy "camera<id>" paths fall back to the numeric id.
function resolveHlsAccessInfo(cameraPath) {
    const byKey = getAccessInfoByStreamKey(cameraPath);
    if (byKey) {
        return byKey;
    }
    const legacyMatch = /^camera(\d+)$/.exec(cameraPath || '');
    return legacyMatch ? getAccessInfo(Number(legacyMatch[1])) : null;
}

export default async function hlsProxyRoutes(fastify, _options) {
    const mediamtxHlsUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
    // Hostnames allowed to hotlink community playlists when a browser omits
    // Sec-Fetch-Site. Derived from the same ALLOWED_ORIGINS list the origin
    // validator uses, so there is one source of truth for "our own site".
    const hlsTrustedHosts = new Set(
        (config.security?.allowedOrigins || [])
            .map((origin) => {
                try {
                    return new URL(origin).hostname.toLowerCase();
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
    );
    const state = createHlsRouteState();
    state.start();

    fastify.addHook('onClose', async () => {
        await state.stop();
    });

    fastify.addHook('onRequest', async (request, reply) => {
        applyHlsCorsHeaders(request, reply);
    });

    fastify.get('/proxy', { preHandler: verifyStreamToken }, async (request, reply) => handleExternalStreamProxy(state, request, reply));

    fastify.get('/*', { preHandler: verifyStreamToken }, async (request, reply) => {
        const fullPath = request.params['*'];
        if (!fullPath) {
            return reply.code(400).send('Invalid path - use /hls/{cameraPath}/index.m3u8');
        }

        const pathParts = fullPath.split('/');
        const cameraPath = pathParts[0];
        const fileName = pathParts[pathParts.length - 1];
        const isTextFile = fileName.endsWith('.m3u8');
        const identity = state.getViewerIdentity(request);
        const cameraId = state.extractCameraId(cameraPath, identity);

        // Tenancy gate: owner_private/subscriber streams require an authorized
        // viewer (owner/staff JWT or camera-bound stream token), and subscriber
        // streams additionally require billing_status=active. Community streams
        // skip all of this and behave exactly as before. The access info is
        // cached (30s TTL), so suspension propagates to live streams within
        // seconds without a DB hit per segment.
        const accessInfo = resolveHlsAccessInfo(cameraPath);
        // Always run the gate when we know the camera: community streams may be voucher-gated
        // (an admin-marked area while the feature is on), which the old `!== community`
        // short-circuit would have skipped. canViewLive returns voucherGated so we can keep the
        // stream out of shared/edge caches.
        let isGatedCamera = false;
        if (accessInfo) {
            const access = canViewLive({
                info: accessInfo,
                user: resolveHlsViewerUser(request),
                streamToken: request.streamToken || null,
                voucherDeviceHash: readVoucherDeviceHash(request),
            });
            isGatedCamera = accessInfo.camera_class !== 'community' || access.voucherGated === true;
            if (access.voucherGated) {
                request.voucherPrivate = true;
            }
            if (!access.allowed) {
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-store');
                const code = access.statusCode === 402 ? 402 : 403;
                return reply.code(code).send('');
            }
        }

        // Anti-hotlink gate for COMMUNITY playlists: a community stream is public
        // ON OUR SITE but must not be embeddable/playable elsewhere. Gating the
        // (no-cache) playlist to same-origin/same-site requests kills off-site
        // playback within seconds — a live stream is dead without its rotating
        // playlist — while the edge-cacheable segments (untouched below) keep CDN
        // performance intact. Non-community already required a stream token above,
        // a stronger gate than any header, so this only hardens community.
        if (isTextFile && accessInfo?.camera_class === 'community'
            && !isTrustedStreamRequest(request.headers, hlsTrustedHosts)) {
            reply.header('Content-Type', 'text/plain');
            reply.header('Cache-Control', 'no-store');
            return reply.code(403).send('');
        }

        if (cameraId && isTextFile) {
            try {
                await state.getOrCreateSession(identity, cameraId, request);
            } catch (error) {
                console.error('[HLSProxy] Session error:', error.message);
            }
        } else if (cameraId && !isTextFile) {
            try {
                await state.recordSegmentAccess(identity, cameraId);
            } catch {
                // Ignore heartbeat errors in streaming path.
            }
        }

        try {
            const targetUrl = `${mediamtxHlsUrl}/${fullPath}`;
            const isInitFile = fileName.includes('init.mp4') || fileName.includes('_init.mp4');
            const headers = {
                'User-Agent': request.headers['user-agent'] || 'HLSProxy',
            };

            let contentType = 'application/octet-stream';
            if (fileName.endsWith('.m3u8')) {
                contentType = 'application/vnd.apple.mpegurl';
            } else if (fileName.endsWith('.ts')) {
                contentType = 'video/mp2t';
            } else if (fileName.endsWith('.mp4') || fileName.endsWith('.m4s')) {
                contentType = 'video/mp4';
            }

            if (isTextFile) {
                const response = await fetchTextUpstream({
                    httpClient: state.httpClient,
                    targetUrl,
                    headers,
                });

                if (response.status !== 200) {
                    reply.header('Content-Type', 'text/plain');
                    reply.header('Cache-Control', 'no-cache');
                    return reply.code(response.status).send('');
                }

                // Playlist stays no-cache — it carries the live edge and
                // rotates every few seconds, plus each playlist fetch
                // re-arms the viewer session (recordSegmentAccess on
                // segments is just a heartbeat optimisation, the
                // playlist fetch is what creates/keeps the session).
                applyLegacyCacheHeaders(reply, contentType);
                if (cameraId) {
                    cameraHealthService.recordRuntimeSignal(cameraId, {
                        targetUrl,
                        signalType: 'internal_hls_playlist_proxy',
                        success: true,
                    });
                }
                // Gated playlists: forward the viewer's stream token into child
                // playlist/segment URIs so the whole HLS tree stays authorized.
                if (isGatedCamera && typeof request.query.token === 'string' && request.query.token) {
                    reply.header('Cache-Control', 'no-store');
                    return reply.send(propagateTokenInPlaylist(response.data, request.query.token));
                }
                return reply.send(response.data);
            }

            const { controller, response } = await fetchBinaryUpstream({
                httpClient: state.httpClient,
                targetUrl,
                headers,
                maxRetries: isInitFile ? 3 : 1,
            });

            if (response.status !== 200) {
                cleanupUpstreamResponse({ controller, response });
                reply.header('Content-Type', 'text/plain');
                reply.header('Cache-Control', 'no-cache');
                return reply.code(response.status).send('');
            }

            // Edge-cacheable internal segments. MediaMTX hands us the
            // same bytes for the same stream_key + segment name, so CF
            // can cache by URL safely. Trade-off: per-segment heartbeats
            // (recordSegmentAccess) will stop firing for cache hits,
            // but the playlist refresh every ~3s already keeps the
            // viewer session warm well inside its 25s TTL.
            //
            // Gated (non-community) segments must NEVER hit the edge cache:
            // a cached segment would be served to any requester without
            // passing the tenancy/billing gate above.
            if (isGatedCamera) {
                reply.header('Cache-Control', 'private, no-store');
            } else {
                applyLegacyCacheHeaders(reply, contentType);
            }

            attachAbortCleanup({
                request,
                reply,
                controller,
                upstreamStream: response.data,
            }).attach();
            if (cameraId) {
                cameraHealthService.recordRuntimeSignal(cameraId, {
                    targetUrl,
                    signalType: 'internal_hls_segment_proxy',
                    success: true,
                });
            }
            return reply.send(response.data);
        } catch (error) {
            console.error(`[HLSProxy] Error proxying ${fullPath}:`, error.message);
            return reply.code(502).send('');
        }
    });
}


