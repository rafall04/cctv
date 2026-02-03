import { query, queryOne } from '../database/database.js';
import { config } from '../config/config.js';
import jwt from 'jsonwebtoken';

const buildStreamUrls = (streamKey) => {
    const hlsBase = (config.mediamtx.hlsUrl || '/hls').replace(/\/$/, '');
    const webrtcBase = (config.mediamtx.webrtcUrl || '/webrtc').replace(/\/$/, '');
    
    return {
        hls: `${hlsBase}/${streamKey}/index.m3u8`,
        webrtc: `${webrtcBase}/${streamKey}`,
    };
};

export async function getStreamUrls(request, reply) {
    try {
        const { cameraId } = request.params;

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
            return reply.code(404).send({
                success: false,
                message: 'Camera not found or disabled',
            });
        }

        // Use stream_key for URL, fallback to camera{id} for legacy
        const streamPath = camera.stream_key || `camera${camera.id}`;

        return reply.send({
            success: true,
            data: {
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
                streams: buildStreamUrls(streamPath),
            },
        });
    } catch (error) {
        console.error('Get stream URLs error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

export async function getAllActiveStreams(request, reply) {
    try {
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
            // Use stream_key for URL, fallback to camera{id} for legacy
            const streamPath = camera.stream_key || `camera${camera.id}`;
            return {
                ...camera,
                streams: buildStreamUrls(streamPath),
            };
        });

        return reply.send({
            success: true,
            data: camerasWithStreams,
        });
    } catch (error) {
        console.error('Get all active streams error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Generate stream access token for secure HLS/WebRTC access
 * Token includes camera ID and stream key, expires in 1 hour
 */
export async function generateStreamToken(request, reply) {
    try {
        const { cameraId } = request.params;

        const camera = queryOne(
            'SELECT id, stream_key, enabled FROM cameras WHERE id = ?',
            [cameraId]
        );

        if (!camera || !camera.enabled) {
            return reply.code(404).send({
                success: false,
                message: 'Camera not found or disabled',
            });
        }

        const streamPath = camera.stream_key || `camera${camera.id}`;
        
        // Generate JWT token with camera info
        const tokenPayload = {
            cameraId: camera.id,
            streamKey: camera.stream_key,
            type: 'stream_access',
        };
        
        const token = jwt.sign(
            tokenPayload,
            config.jwt.secret,
            { expiresIn: '1h' } // Token valid for 1 hour
        );
        
        return reply.send({
            success: true,
            data: {
                token,
                streamUrl: buildStreamUrls(streamPath).hls,
                expiresIn: 3600, // 1 hour in seconds
            },
        });
    } catch (error) {
        console.error('Generate stream token error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}
