import {
    getAllAreas,
    getAreaById,
    createArea,
    updateArea,
    deleteArea,
    getAreaFilters,
    getAreaAdminOverview,
    getAreaSummary,
} from '../controllers/areaController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import {
    createAreaSchema,
    updateAreaSchema,
    areaIdParamSchema,
} from '../middleware/schemaValidators.js';

export default async function areaRoutes(fastify, options) {
    // Public endpoints - for landing page filter
    fastify.get('/public', {
        handler: getAllAreas,
    });
    
    fastify.get('/filters', {
        handler: getAreaFilters,
    });

    fastify.get('/summary', {
        onRequest: [authMiddleware],
        handler: getAreaSummary,
    });

    fastify.get('/overview', {
        onRequest: [authMiddleware],
        handler: getAreaAdminOverview,
    });

    // Admin endpoints (protected)
    fastify.get('/', {
        onRequest: [authMiddleware],
        handler: getAllAreas,
    });

    fastify.get('/:id', {
        schema: areaIdParamSchema,
        onRequest: [authMiddleware],
        handler: getAreaById,
    });

    fastify.post('/', {
        schema: createAreaSchema,
        onRequest: [authMiddleware],
        handler: createArea,
    });

    fastify.put('/:id', {
        schema: updateAreaSchema,
        onRequest: [authMiddleware],
        handler: updateArea,
    });

    fastify.delete('/:id', {
        schema: areaIdParamSchema,
        onRequest: [authMiddleware],
        handler: deleteArea,
    });
}
