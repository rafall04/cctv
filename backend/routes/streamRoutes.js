import { getStreamUrls, getAllActiveStreams, generateStreamToken } from '../controllers/streamController.js';
import { streamCameraIdParamSchema } from '../middleware/schemaValidators.js';

export default async function streamRoutes(fastify, options) {
    // Public endpoints - no authentication required

    // Get stream URLs for specific camera
    fastify.get('/:cameraId', {
        schema: streamCameraIdParamSchema,
        handler: getStreamUrls,
    });

    // Get all active cameras with stream URLs
    fastify.get('/', getAllActiveStreams);

    // Generate secure stream access token
    // Returns token that must be included in HLS URL query parameter
    fastify.get('/:cameraId/token', {
        schema: streamCameraIdParamSchema,
        handler: generateStreamToken,
    });
}
