/**
 * Purpose: Build public stream responses with delivery metadata, availability, thumbnails, and lightweight viewer stats.
 * Caller: streamController public stream endpoints and stream service tests.
 * Deps: connectionPool, config, jsonwebtoken, thumbnailPathService, cameraHealthService, cameraViewStatsService, camera delivery/projection utils.
 * MainFuncs: buildCameraResponse, buildStreamUrls, getStreamUrls, getAllActiveStreams, generateStreamToken.
 * SideEffects: Reads camera rows and active viewer aggregates; no writes.
 */

import { query, queryOne } from '../database/connectionPool.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';
import { sanitizeCameraThumbnailList } from './thumbnailPathService.js';
import cameraHealthService from './cameraHealthService.js';
import cameraViewStatsService from './cameraViewStatsService.js';
import { getAccessInfo, canViewLive } from './cameraAccessService.js';
import { PUBLIC_LIVE_SQL } from '../utils/cameraVisibility.js';
import {
    getEffectiveDeliveryType,
    getStreamCapabilities,
} from '../utils/cameraDelivery.js';
import { SHARED_CAMERA_STREAM_PROJECTION, SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION } from '../utils/cameraProjection.js';

function resolveViewerStats(statsByCamera, cameraId) {
    return statsByCamera[cameraId] || cameraViewStatsService.emptyStats;
}

class StreamService {
    buildCameraResponse(camera) {
        const deliveryType = getEffectiveDeliveryType(camera);
        const streamPath = camera.stream_key || `camera${camera.id}`;
        const capabilities = getStreamCapabilities(deliveryType);
        const isExternalHls = deliveryType === 'external_hls';
        const availability = cameraHealthService.enrichCameraAvailability(camera);
        // F4: also strip `stream_key` from the public payload. The HLS URL
        // itself (streams.hls = /hls/{stream_key}/index.m3u8) still embeds
        // the value, so this is mostly cosmetic — but it removes one extra
        // place where scrapers can pluck the path identifier without
        // parsing URLs. private_rtsp_url stays stripped as before.
        const { private_rtsp_url, stream_key, ...publicAvailability } = availability;

        // For external_hls cameras with proxying enabled (the default), the
        // response's `streams.hls` is now an opaque /api/stream/:id/external.m3u8
        // path served by externalStreamProxyRoutes (G2). The actual government /
        // pemda upstream URL no longer needs to leave the backend at this
        // step. Only when an admin explicitly turns `external_use_proxy` off
        // do we hand the browser the raw URL, matching the existing
        // "direct-stream" mode.
        const externalProxyEnabled = isExternalHls && (
            camera.external_use_proxy === undefined
            || camera.external_use_proxy === null
            || camera.external_use_proxy === 1
            || camera.external_use_proxy === true
        );
        const externalRawUrl = camera.external_stream_url || camera.external_hls_url || null;
        const externalStreams = isExternalHls
            ? {
                hls: externalProxyEnabled
                    ? `/api/stream/${camera.id}/external.m3u8`
                    : externalRawUrl,
                webrtc: null,
            }
            : null;

        // G4: when external_hls is being served through the opaque /api/stream
        // proxy (the default), the raw external_hls_url / external_stream_url
        // values are no longer needed by the public client — the player only
        // consumes streams.hls. Strip those fields from the response so the
        // government / pemda URL never ships to the browser at all.
        //
        // Other delivery types are NOT sanitized here:
        //   - direct-stream mode (external_use_proxy off) still needs the
        //     raw URL on the client to play directly,
        //   - external_embed / external_mjpeg / external_jsmpeg use their own
        //     dedicated URL fields and are out of scope for HLS proxying.
        const stripExternalHlsUrls = isExternalHls && externalProxyEnabled;
        const sanitizedExternalHlsUrl = stripExternalHlsUrls
            ? null
            : (camera.external_hls_url || (deliveryType === 'external_hls' ? camera.external_stream_url || null : null));
        const sanitizedExternalStreamUrl = stripExternalHlsUrls
            ? null
            : (camera.external_stream_url || (deliveryType === 'external_hls' ? camera.external_hls_url || null : null));

        return {
            ...publicAvailability,
            delivery_type: deliveryType,
            stream_capabilities: capabilities,
            streams: isExternalHls
                ? externalStreams
                : (deliveryType === 'internal_hls' ? this.buildStreamUrls(streamPath, camera._requestHost) : {}),
            stream_source: camera.stream_source || (deliveryType === 'internal_hls' ? 'internal' : 'external'),
            external_hls_url: sanitizedExternalHlsUrl,
            external_stream_url: sanitizedExternalStreamUrl,
            external_embed_url: camera.external_embed_url || null,
            external_snapshot_url: camera.external_snapshot_url || null,
            external_origin_mode: camera.external_origin_mode || 'direct',
        };
    }

    buildStreamUrls(streamKey, requestHost) {
        let hlsBase = (config.mediamtx.hlsUrl || '/hls').replace(/\/$/, '');
        let webrtcBase = (config.mediamtx.webrtcUrl || '/webrtc').replace(/\/$/, '');

        const isIpAccess = requestHost && (
            /^(\d{1,3}\.){3}\d{1,3}$/.test(requestHost) ||
            (requestHost.includes(':') && !requestHost.includes('localhost'))
        );

        if (isIpAccess) {
            try {
                if (hlsBase.startsWith('http')) {
                    const url = new URL(hlsBase);
                    hlsBase = url.pathname;
                }
                if (webrtcBase.startsWith('http')) {
                    const url = new URL(webrtcBase);
                    webrtcBase = url.pathname;
                }
            } catch (e) {
                // Ignore parsing errors
            }
        }

        return {
            hls: `${hlsBase}/${streamKey}/index.m3u8`,
            webrtc: `${webrtcBase}/${streamKey}`,
        };
    }

    getStreamUrls(cameraId, requestHost, user = null) {
        // Tenancy gate first: non-community cameras (owner_private/subscriber) are only
        // visible to staff or their owner, and subscriber cameras must be billing-active.
        const accessInfo = getAccessInfo(cameraId);
        const access = canViewLive({ info: accessInfo, user });
        if (!access.allowed) {
            const err = new Error(
                access.reason === 'subscription_suspended'
                    ? 'Camera suspended - subscription payment required'
                    : 'Camera not found or disabled'
            );
            err.statusCode = access.statusCode === 402 ? 402 : 404;
            throw err;
        }

        const camera = queryOne(
            `SELECT ${SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION}
             FROM cameras c
             LEFT JOIN areas a ON c.area_id = a.id
             WHERE c.id = ? AND c.enabled = 1`,
            [cameraId]
        );

        if (!camera) {
            const err = new Error('Camera not found or disabled');
            err.statusCode = 404;
            throw err;
        }

        const responseCamera = this.buildCameraResponse({
            ...camera,
            _requestHost: requestHost,
        });

        return {
            camera: {
                id: responseCamera.id,
                name: responseCamera.name,
                description: responseCamera.description,
                location: responseCamera.location,
                group_name: responseCamera.group_name,
                area_id: responseCamera.area_id,
                area_name: responseCamera.area_name,
                is_tunnel: responseCamera.is_tunnel,
                latitude: responseCamera.latitude,
                longitude: responseCamera.longitude,
                video_codec: responseCamera.video_codec,
                rt: responseCamera.rt,
                rw: responseCamera.rw,
                kelurahan: responseCamera.kelurahan,
                kecamatan: responseCamera.kecamatan,
                availability_state: responseCamera.availability_state,
                availability_reason: responseCamera.availability_reason,
                availability_confidence: responseCamera.availability_confidence,
                external_use_proxy: responseCamera.external_use_proxy,
                external_tls_mode: responseCamera.external_tls_mode,
                delivery_type: responseCamera.delivery_type,
                stream_capabilities: responseCamera.stream_capabilities,
                external_stream_url: responseCamera.external_stream_url,
                external_embed_url: responseCamera.external_embed_url,
                external_snapshot_url: responseCamera.external_snapshot_url,
                external_origin_mode: responseCamera.external_origin_mode,
            },
            streams: responseCamera.streams,
            stream_source: responseCamera.stream_source,
            delivery_type: responseCamera.delivery_type,
            stream_capabilities: responseCamera.stream_capabilities,
            external_use_proxy: responseCamera.external_use_proxy,
            external_tls_mode: responseCamera.external_tls_mode,
            external_stream_url: responseCamera.external_stream_url,
            external_embed_url: responseCamera.external_embed_url,
            external_snapshot_url: responseCamera.external_snapshot_url,
            external_origin_mode: responseCamera.external_origin_mode,
            availability_state: responseCamera.availability_state,
            availability_reason: responseCamera.availability_reason,
            availability_confidence: responseCamera.availability_confidence,
        };
    }

    getAllActiveStreams(requestHost) {
        const cameras = query(
            `SELECT ${SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION}
             FROM cameras c
             LEFT JOIN areas a ON c.area_id = a.id
             WHERE c.enabled = 1 AND ${PUBLIC_LIVE_SQL}
             ORDER BY c.is_tunnel ASC, c.id ASC`
        );
        const statsByCamera = cameraViewStatsService.getPublicStatsByCamera();

        const camerasWithStreams = cameras.map((camera) => this.buildCameraResponse({
            ...camera,
            _requestHost: requestHost,
            viewer_stats: resolveViewerStats(statsByCamera, camera.id),
        }));

        return sanitizeCameraThumbnailList(camerasWithStreams);
    }

    generateStreamToken(cameraId, requestHost, user = null) {
        const camera = queryOne(
            'SELECT id, stream_key, enabled FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera || !camera.enabled) {
            const err = new Error('Camera not found or disabled');
            err.statusCode = 404;
            throw err;
        }

        // Non-community cameras only hand out stream tokens to staff or the owner,
        // and a suspended subscriber camera hands them to staff only. The /hls proxy
        // independently re-checks billing on every playlist fetch, so a token issued
        // moments before a suspension cannot outlive it by more than the access-cache TTL.
        const access = canViewLive({ info: getAccessInfo(cameraId), user });
        if (!access.allowed) {
            const err = new Error(
                access.reason === 'subscription_suspended'
                    ? 'Camera suspended - subscription payment required'
                    : 'Camera not found or disabled'
            );
            err.statusCode = access.statusCode === 402 ? 402 : 404;
            throw err;
        }

        const streamPath = camera.stream_key || `camera${camera.id}`;

        const tokenPayload = {
            cameraId: camera.id,
            streamKey: camera.stream_key,
            type: 'stream_access',
        };

        const token = jwt.sign(
            tokenPayload,
            config.jwt.secret,
            { expiresIn: '1h' }
        );

        return {
            token,
            streamUrl: this.buildStreamUrls(streamPath, requestHost).hls,
            expiresIn: 3600,
        };
    }
}

export default new StreamService();
