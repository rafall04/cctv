import { query, queryOne } from '../database/database.js';
import { config } from '../config/config.js';

/**
 * Build stream URLs for a camera
 * 
 * URL Strategy:
 * - If PUBLIC_STREAM_BASE_URL is configured, URLs will be absolute
 *   Example: https://api-cctv.raf.my.id/hls/camera1/index.m3u8
 * - Otherwise, URLs will be relative (frontend prepends API URL)
 *   Example: /hls/camera1/index.m3u8
 * 
 * IMPORTANT: Frontend should NEVER access MediaMTX directly (localhost:8888)
 * All stream requests go through: Frontend -> Backend/Nginx -> MediaMTX
 */
const buildStreamUrls = (cameraId) => {
    const streamPath = `camera${cameraId}`;
    
    // Get base URLs from config
    // These are already processed by config.js to be either:
    // - Relative paths (e.g., /hls)
    // - Absolute URLs (e.g., https://api-cctv.raf.my.id/hls)
    const hlsBase = config.mediamtx.hlsUrl || '/hls';
    const webrtcBase = config.mediamtx.webrtcUrl || '/webrtc';
    
    // Build full stream URLs
    // Remove trailing slash from base if present
    const cleanHlsBase = hlsBase.replace(/\/$/, '');
    const cleanWebrtcBase = webrtcBase.replace(/\/$/, '');
    
    return {
        hls: `${cleanHlsBase}/${streamPath}/index.m3u8`,
        webrtc: `${cleanWebrtcBase}/${streamPath}`,
    };
};

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

        // Generate stream URLs using RELATIVE paths only
        // Frontend will access these through the same origin (nginx proxies to MediaMTX)
        // Example: /hls/camera1/index.m3u8 -> nginx -> localhost:8888/camera1/index.m3u8
        const streamUrls = buildStreamUrls(camera.id);

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

        const camerasWithStreams = cameras.map(camera => ({
            ...camera,
            streams: buildStreamUrls(camera.id),
        }));

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
