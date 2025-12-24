import {
    getAllAreas,
    getAreaById,
    createArea,
    updateArea,
    deleteArea,
} from '../controllers/areaController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function areaRoutes(fastify, options) {
    // Admin endpoints (protected)
    fastify.get('/', {
        onRequest: [authMiddleware],
        handler: getAllAreas,
    });

    fastify.get('/:id', {
        onRequest: [authMiddleware],
        handler: getAreaById,
    });

    fastify.post('/', {
        onRequest: [authMiddleware],
        handler: createArea,
    });

    fastify.put('/:id', {
        onRequest: [authMiddleware],
        handler: updateArea,
    });

    fastify.delete('/:id', {
        onRequest: [authMiddleware],
        handler: deleteArea,
    });
}
