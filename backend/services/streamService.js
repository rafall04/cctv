import { query, queryOne } from '../database/connectionPool.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';
import { sanitizeCameraThumbnailList } from './thumbnailPathService.js';
import {
    getEffectiveDeliveryType,
    getStreamCapabilities,
} from '../utils/cameraDelivery.js';

class StreamService {
    buildCameraResponse(camera) {
        const deliveryType = getEffectiveDeliveryType(camera);
        const streamPath = camera.stream_key || `camera${camera.id}`;
        const capabilities = getStreamCapabilities(deliveryType);
        const isExternalHls = deliveryType === 'external_hls';

        return {
            ...camera,
            delivery_type: deliveryType,
            stream_capabilities: capabilities,
            streams: isExternalHls
                ? { hls: camera.external_stream_url || camera.external_hls_url, webrtc: null }
                : (deliveryType === 'internal_hls' ? this.buildStreamUrls(streamPath, camera._requestHost) : {}),
            stream_source: camera.stream_source || (deliveryType === 'internal_hls' ? 'internal' : 'external'),
            external_hls_url: camera.external_hls_url || (deliveryType === 'external_hls' ? camera.external_stream_url || null : null),
            external_stream_url: camera.external_stream_url || (deliveryType === 'external_hls' ? camera.external_hls_url || null : null),
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

    getStreamUrls(cameraId, requestHost) {
        const camera = queryOne(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel,
                    c.latitude, c.longitude, c.stream_key, c.video_codec, c.stream_source, c.external_hls_url,
                    c.delivery_type, c.external_stream_url, c.external_embed_url, c.external_snapshot_url,
                    CASE
                        WHEN c.external_origin_mode IN ('direct', 'embed') THEN c.external_origin_mode
                        ELSE 'direct'
                    END as external_origin_mode,
                    COALESCE(c.external_use_proxy, 1) as external_use_proxy,
                    CASE
                        WHEN c.external_tls_mode IN ('strict', 'insecure') THEN c.external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode,
                    a.name as area_name, a.rt, a.rw, a.kelurahan, a.kecamatan
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
        };
    }

    getAllActiveStreams(requestHost) {
        const cameras = query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel,
                    c.latitude, c.longitude, c.status, c.is_online, c.last_online_check, c.stream_key, c.video_codec,
                    c.thumbnail_path, c.thumbnail_updated_at, c.stream_source, c.external_hls_url,
                    c.delivery_type, c.external_stream_url, c.external_embed_url, c.external_snapshot_url,
                    CASE
                        WHEN c.external_origin_mode IN ('direct', 'embed') THEN c.external_origin_mode
                        ELSE 'direct'
                    END as external_origin_mode,
                    COALESCE(c.external_use_proxy, 1) as external_use_proxy,
                    CASE
                        WHEN c.external_tls_mode IN ('strict', 'insecure') THEN c.external_tls_mode
                        ELSE 'strict'
                    END as external_tls_mode,
                    a.name as area_name, a.rt, a.rw, a.kelurahan, a.kecamatan
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.is_tunnel ASC, c.id ASC`
        );

        const camerasWithStreams = cameras.map((camera) => this.buildCameraResponse({
            ...camera,
            _requestHost: requestHost,
        }));

        return sanitizeCameraThumbnailList(camerasWithStreams);
    }

    generateStreamToken(cameraId, requestHost) {
        const camera = queryOne(
            'SELECT id, stream_key, enabled FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera || !camera.enabled) {
            const err = new Error('Camera not found or disabled');
            err.statusCode = 404;
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
