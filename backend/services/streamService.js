import { query, queryOne } from '../database/connectionPool.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';

class StreamService {
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
                    c.latitude, c.longitude, c.stream_key, c.video_codec,
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

        const streamPath = camera.stream_key || `camera${camera.id}`;

        return {
            camera: {
                id: camera.id,
                name: camera.name,
                description: camera.description,
                location: camera.location,
                group_name: camera.group_name,
                area_id: camera.area_id,
                area_name: camera.area_name,
                is_tunnel: camera.is_tunnel,
                latitude: camera.latitude,
                longitude: camera.longitude,
                video_codec: camera.video_codec,
                rt: camera.rt,
                rw: camera.rw,
                kelurahan: camera.kelurahan,
                kecamatan: camera.kecamatan,
            },
            streams: this.buildStreamUrls(streamPath, requestHost),
        };
    }

    getAllActiveStreams(requestHost) {
        const cameras = query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, c.is_tunnel,
                    c.latitude, c.longitude, c.status, c.is_online, c.last_online_check, c.stream_key, c.video_codec,
                    c.thumbnail_path, c.thumbnail_updated_at,
                    a.name as area_name, a.rt, a.rw, a.kelurahan, a.kecamatan
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.is_tunnel ASC, c.id ASC`
        );

        const camerasWithStreams = cameras.map(camera => {
            const streamPath = camera.stream_key || `camera${camera.id}`;
            return {
                ...camera,
                streams: this.buildStreamUrls(streamPath, requestHost),
            };
        });

        return camerasWithStreams;
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
