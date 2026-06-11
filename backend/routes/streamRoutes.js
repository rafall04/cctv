import { getStreamUrls, getAllActiveStreams, generateStreamToken } from '../controllers/streamController.js';
import { streamCameraIdParamSchema } from '../middleware/schemaValidators.js';
import { optionalAuthMiddleware } from '../middleware/authMiddleware.js';

export default async function streamRoutes(fastify, options) {
    // Public endpoints. optionalAuthMiddleware decodes the JWT when present so the
    // tenancy gate can recognize staff/owners on non-community cameras; anonymous
    // visitors keep full access to community cameras exactly as before.

    // Get stream URLs for specific camera
    fastify.get('/:cameraId', {
        schema: streamCameraIdParamSchema,
        onRequest: [optionalAuthMiddleware],
        handler: getStreamUrls,
    });

    // Get all active cameras with stream URLs (community-class only)
    fastify.get('/', getAllActiveStreams);

    // Generate secure stream access token
    // Returns token that must be included in HLS URL query parameter
    fastify.get('/:cameraId/token', {
        schema: streamCameraIdParamSchema,
        onRequest: [optionalAuthMiddleware],
        handler: generateStreamToken,
    });
}
