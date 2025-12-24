import { query, queryOne } from '../database/database.js';
import { config } from '../config/config.js';

// Get stream URLs for a specific camera (public endpoint)
export async function getStreamUrls(request, reply) {
    try {
        const { cameraId } = request.params;

        // Get camera info (only if enabled)
        const camera = queryOne(
            `SELECT c.id, c.name, c.location, c.group_name, c.area_id, a.name as area_name 
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

        // Generate stream URLs
        // MediaMTX path format: /camera{id}
        const streamPath = `camera${camera.id}`;

        const streamUrls = {
            hls: `${config.mediamtx.hlsUrl}/${streamPath}/index.m3u8`,
            webrtc: `${config.mediamtx.webrtcUrl}/${streamPath}`,
        };

        return reply.send({
            success: true,
            data: {
                camera: {
                    id: camera.id,
                    name: camera.name,
                    location: camera.location,
                    group_name: camera.group_name,
                    area_id: camera.area_id,
                    area_name: camera.area_name,
                },
                streams: streamUrls,
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

// Get all active cameras with stream URLs (public endpoint)
export async function getAllActiveStreams(request, reply) {
    try {
        const cameras = query(
            `SELECT c.id, c.name, c.description, c.location, c.group_name, c.area_id, a.name as area_name 
             FROM cameras c 
             LEFT JOIN areas a ON c.area_id = a.id 
             WHERE c.enabled = 1 
             ORDER BY c.id ASC`
        );

        const camerasWithStreams = cameras.map(camera => {
            const streamPath = `camera${camera.id}`;
            return {
                ...camera,
                streams: {
                    hls: `${config.mediamtx.hlsUrl}/${streamPath}/index.m3u8`,
                    webrtc: `${config.mediamtx.webrtcUrl}/${streamPath}`,
                },
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
