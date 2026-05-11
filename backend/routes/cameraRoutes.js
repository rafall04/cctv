/**
 * Purpose: Registers camera public/admin routes, including source lifecycle recovery endpoints.
 * Caller: backend/server.js route bootstrap.
 * Deps: cameraController handlers, authMiddleware, schemaValidators, cacheMiddleware.
 * MainFuncs: cameraRoutes.
 * SideEffects: Adds Fastify camera route definitions.
 */

import {
    getAllCameras,
    getActiveCameras,
    getCameraById,
    createCamera,
    updateCamera,
    refreshCameraStream,
    getCameraSourceLifecycleEvents,
    deleteCamera,
    exportCameras,
    importCameras,
    previewImportCameras,
    previewCameraRestore,
    applyCameraRestore,
    bulkUpdateByArea,
    bulkDeleteByArea,
} from '../controllers/cameraController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { 
    createCameraSchema, 
    updateCameraSchema, 
    cameraIdParamSchema 
} from '../middleware/schemaValidators.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';

export default async function cameraRoutes(fastify, options) {
    // Public endpoints - with caching
    fastify.get('/active', {
        preHandler: cacheMiddleware(30000),  // Cache for 30 seconds
        handler: getActiveCameras,
    });

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

    fastify.post('/:id/stream/refresh', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: refreshCameraStream,
    });

    fastify.get('/:id/stream/events', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: getCameraSourceLifecycleEvents,
    });

    fastify.delete('/:id', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: deleteCamera,
    });
    
    // Bulk Export
    fastify.get('/export', {
        onRequest: [authMiddleware],
        handler: exportCameras,
    });

    // Bulk Import
    fastify.post('/import', {
        onRequest: [authMiddleware],
        handler: importCameras,
    });

    fastify.post('/import/preview', {
        onRequest: [authMiddleware],
        handler: previewImportCameras,
    });

    fastify.post('/restore/preview', {
        onRequest: [authMiddleware],
        handler: previewCameraRestore,
    });

    fastify.post('/restore/apply', {
        onRequest: [authMiddleware],
        handler: applyCameraRestore,
    });

    // Bulk Update By Area
    fastify.patch('/bulk/area', {
        onRequest: [authMiddleware],
        handler: bulkUpdateByArea,
    });

    // Bulk Delete By Area
    fastify.delete('/bulk/area/:areaId', {
        onRequest: [authMiddleware],
        handler: bulkDeleteByArea,
    });
}
