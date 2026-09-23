/*
 * Purpose: Opaque MJPEG relay — GET /api/stream/:id/external.mjpeg streams the camera's
 *          external_mjpeg upstream through the backend so its (often token-bearing) URL never
 *          reaches the browser. Registered alongside the opaque HLS proxy via the
 *          externalStreamProxyRoutes adapter.
 * Caller: routes/externalStreamProxyRoutes.js → server.js under /api/stream.
 * Deps: connectionPool (camera lookup), cameraAccessService (canViewLive gate), voucherPass,
 *       hlsProxyService (verifyStreamToken, SSRF allowlist, http client, viewer-session state),
 *       cameraHealthService (runtime signals), utils/cameraDelivery (delivery-type resolution).
 * MainFuncs: registerExternalMjpegProxyRoutes (fastify plugin).
 * SideEffects: one upstream connection per open viewer (no cache/dedup — MJPEG is infinite);
 *              viewer-session heartbeat at connect + every 30s while open; runtime signals.
 *
 * WHY THIS EXISTS
 * ---------------
 * An MJPEG stream is rendered as <img src>, which meant the upstream URL — routinely a
 * ZoneMinder /zm/cgi-bin/nph-zms URL carrying a ?token= JWT — had to be published verbatim in
 * the public camera payload. The public payload now rewrites external_stream_url to this
 * opaque path (publicLandingProjection.mjpegOpaquePath), so the token never leaves the backend.
 *
 * Deliberate differences from the sibling HLS proxy:
 *   - external_use_proxy does NOT apply. That flag is the admin's "let the browser play the HLS
 *     URL directly" switch; for MJPEG there is no safe direct mode — this relay is the only
 *     published path, so it serves whenever the camera resolves to external_mjpeg.
 *   - NO caching, NO stale fallback: the response is an infinite multipart stream; each viewer
 *     holds one upstream connection that is piped straight through.
 *   - Same gates as the HLS paths: verifyStreamToken preHandler + canViewLive + the SSRF
 *     allowlist — a voucher-gated or private camera cannot be viewed through the relay.
 */

import https from 'https';
import { queryOne } from '../database/connectionPool.js';
import cameraHealthService from '../services/cameraHealthService.js';
import { getAccessInfo, canViewLive } from '../services/cameraAccessService.js';
import { readVoucherDeviceHash } from '../services/voucherPass.js';
import {
    isExternalProxyTargetAllowed,
    createHlsHttpClient,
    createHlsRouteState,
    verifyStreamToken,
    resolveHlsViewerUser,
} from '../services/hlsProxyService.js';
import { getEffectiveDeliveryType } from '../utils/cameraDelivery.js';
import { config } from '../config/config.js';

const DEFAULT_TIMEOUT_MS = 30000;
const CAMERA_CACHE_TTL_MS = 30000;
const CAMERA_NEGATIVE_TTL_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 30000;

function lookupMjpegCamera(cameraId) {
    const parsed = Number.parseInt(cameraId, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) return null;
    try {
        return queryOne(
            `SELECT id, stream_source, delivery_type,
                    external_hls_url, external_stream_url, external_embed_url,
                    CASE
                        WHEN external_tls_mode IN ('strict', 'insecure') THEN external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode
             FROM cameras
             WHERE id = ?`,
            [parsed]
        );
    } catch (error) {
        console.error('[ExternalMjpegProxy] camera lookup error:', error.message);
        return null;
    }
}

/**
 * The upstream URL this relay fetches. Same fallback order the public players used when they
 * still received the raw URL (stream → hls → embed), so the relay fetches exactly the URL the
 * browser would have been handed before this endpoint existed.
 */
function resolveMjpegSourceUrl(camera) {
    if (!camera || camera.stream_source !== 'external') return null;
    if (getEffectiveDeliveryType(camera) !== 'external_mjpeg') return null;
    return camera.external_stream_url || camera.external_hls_url || camera.external_embed_url || null;
}

/**
 * Tenancy/billing gate — mirrors the HLS proxy's denyIfNotViewable exactly: community cameras
 * pass untouched; private/subscriber need a staff/owner JWT or stream token; voucher-gated
 * areas need the device pass. Fail-closed on a null camera row.
 */
function denyIfNotViewable(request, reply, cameraId) {
    const info = getAccessInfo(cameraId);
    request.streamGated = info?.camera_class !== 'community';
    const access = canViewLive({
        info,
        user: resolveHlsViewerUser(request),
        streamToken: request.streamToken || null,
        voucherDeviceHash: readVoucherDeviceHash(request),
    });
    if (access.voucherGated) {
        request.voucherPrivate = true;
        request.streamGated = true;
    }
    if (access.allowed) return false;
    reply.header('Cache-Control', 'no-store');
    reply.code(access.statusCode === 402 ? 402 : 403).send('');
    return true;
}

export async function registerExternalMjpegProxyRoutes(fastify, options = {}) {
    const hlsConfig = config.security?.hls || {};
    const timeout = options.timeout || hlsConfig.externalProxyTimeoutMs || DEFAULT_TIMEOUT_MS;
    const allowOptions = {
        allowPrivateHosts: options.allowPrivateHosts ?? hlsConfig.externalProxyAllowPrivateHosts ?? false,
        allowedHosts: options.allowedHosts ?? hlsConfig.externalProxyAllowedHosts ?? [],
    };
    const baseClient = options.httpClient || createHlsHttpClient(timeout);

    // Viewer-session state shared with the HLS sibling when the adapter injects one —
    // a viewer watching HLS then MJPEG is ONE session, not two.
    const ownRouteState = !options.routeState;
    const routeState = options.routeState || createHlsRouteState();
    if (ownRouteState) routeState.start();

    const cameraCache = new Map(); // cameraId -> { camera, expiresAt }

    function getCameraCached(cameraId) {
        const key = String(cameraId);
        const now = Date.now();
        const cached = cameraCache.get(key);
        if (cached && cached.expiresAt > now) return cached.camera;
        const camera = lookupMjpegCamera(cameraId);
        cameraCache.set(key, {
            camera,
            expiresAt: now + (camera ? CAMERA_CACHE_TTL_MS : CAMERA_NEGATIVE_TTL_MS),
        });
        return camera;
    }

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
            console.error(`[ExternalMjpegProxy] viewer session ${kind} error camera=${cameraId}:`, error.message);
        }
    }

    fastify.addHook('onClose', async () => {
        cameraCache.clear();
        if (ownRouteState) await routeState.stop();
    });

    fastify.get('/:cameraId/external.mjpeg', { preHandler: verifyStreamToken }, async (request, reply) => {
        const camera = getCameraCached(request.params.cameraId);
        const sourceUrl = resolveMjpegSourceUrl(camera);
        if (!sourceUrl) {
            return reply.code(404).send('Camera not found or not proxyable');
        }

        if (denyIfNotViewable(request, reply, camera.id)) {
            return reply;
        }

        if (!isExternalProxyTargetAllowed(sourceUrl, allowOptions)) {
            return reply.code(400).send('Camera external URL not allowed');
        }

        await trackViewerHeartbeat(request, camera.id, 'playlist');

        const httpClient = camera.external_tls_mode === 'insecure'
            ? createHlsHttpClient(timeout, { httpsAgent: new https.Agent({ rejectUnauthorized: false }) })
            : baseClient;

        let upstream;
        try {
            upstream = await httpClient.get(sourceUrl, {
                responseType: 'stream',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept': 'multipart/x-mixed-replace, image/*',
                },
                // An MJPEG stream never ends, so axios' timeout is the socket-IDLE guard:
                // a source that stops sending frames for `timeout` ms is dead and gets cut,
                // rather than pinning an upstream connection forever.
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
        } catch (error) {
            console.error(`[ExternalMjpegProxy] connect error camera=${camera.id}:`, error.message);
            cameraHealthService.recordRuntimeSignal(camera.id, {
                targetUrl: sourceUrl,
                signalType: 'external_mjpeg_proxy',
                success: false,
            });
            return reply.code(502).send('');
        }

        cameraHealthService.recordRuntimeSignal(camera.id, {
            targetUrl: sourceUrl,
            signalType: 'external_mjpeg_proxy',
            success: true,
        });

        // <img> has no heartbeat loop — keep the viewer session warm while the stream is open.
        const heartbeatTimer = setInterval(() => {
            trackViewerHeartbeat(request, camera.id, 'segment').catch(() => {});
        }, HEARTBEAT_INTERVAL_MS);

        const stream = upstream.data;
        const teardown = () => {
            clearInterval(heartbeatTimer);
            stream.destroy();
        };
        // Client gone → kill the upstream fetch immediately (the relay must not hold a
        // connection to a camera nobody is watching).
        request.raw.on('close', teardown);
        stream.on('end', teardown);
        stream.on('error', () => {
            teardown();
            reply.raw.destroy();
        });

        reply.hijack();
        reply.raw.writeHead(upstream.status === 200 ? 200 : 502, {
            'Content-Type': upstream.headers?.['content-type'] || 'multipart/x-mixed-replace',
            'Cache-Control': 'private, no-store',
            'X-RAFNET-Proxy-Cache': 'BYPASS',
        });
        stream.pipe(reply.raw);
        return reply;
    });
}

export default registerExternalMjpegProxyRoutes;
