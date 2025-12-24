import {
    getAllCameras,
    getActiveCameras,
    getCameraById,
    createCamera,
    updateCamera,
    deleteCamera,
} from '../controllers/cameraController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function cameraRoutes(fastify, options) {
    // Public endpoints
    fastify.get('/active', getActiveCameras);

    // Admin endpoints (protected)
    fastify.get('/', {
        onRequest: [authMiddleware],
        handler: getAllCameras,
    });

    fastify.get('/:id', {
        onRequest: [authMiddleware],
        handler: getCameraById,
    });

    fastify.post('/', {
        onRequest: [authMiddleware],
        handler: createCamera,
    });

    fastify.put('/:id', {
        onRequest: [authMiddleware],
        handler: updateCamera,
    });

    fastify.delete('/:id', {
        onRequest: [authMiddleware],
        handler: deleteCamera,
    });
}
