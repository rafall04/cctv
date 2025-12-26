import {
    getAllCameras,
    getActiveCameras,
    getCameraById,
    createCamera,
    updateCamera,
    deleteCamera,
} from '../controllers/cameraController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { 
    createCameraSchema, 
    updateCameraSchema, 
    cameraIdParamSchema 
} from '../middleware/schemaValidators.js';

export default async function cameraRoutes(fastify, options) {
    // Public endpoints
    fastify.get('/active', getActiveCameras);

    // Admin endpoints (protected)
    fastify.get('/', {
        onRequest: [authMiddleware],
        handler: getAllCameras,
    });

    fastify.get('/:id', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: getCameraById,
    });

    fastify.post('/', {
        schema: createCameraSchema,
        onRequest: [authMiddleware],
        handler: createCamera,
    });

    fastify.put('/:id', {
        schema: updateCameraSchema,
        onRequest: [authMiddleware],
        handler: updateCamera,
    });

    fastify.delete('/:id', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: deleteCamera,
    });
}
