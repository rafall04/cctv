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
} from '../services/hlsProxyService.js';

export default async function hlsProxyRoutes(fastify, _options) {
    const mediamtxHlsUrl = config.mediamtx?.hlsUrlInternal || 'http://localhost:8888';
    const state = createHlsRouteState();
    state.start();

    fastify.addHook('onClose', async () => {
        await state.stop();
    });

    fastify.addHook('onRequest', async (request, reply) => {
        applyHlsCorsHeaders(request, reply);
    });

    fastify.get('/proxy', async (request, reply) => handleExternalStreamProxy(state, request, reply));

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
            applyLegacyCacheHeaders(reply, contentType);

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


