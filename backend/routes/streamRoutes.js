import { getStreamUrls, getAllActiveStreams } from '../controllers/streamController.js';

export default async function streamRoutes(fastify, options) {
    // Public endpoints - no authentication required

    // Get stream URLs for specific camera
    fastify.get('/:cameraId', getStreamUrls);

    // Get all active cameras with stream URLs
    fastify.get('/', getAllActiveStreams);
}
