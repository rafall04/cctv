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
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
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
        onRequest: [authMiddleware, requireAdmin],
        handler: createCamera,
    });

    fastify.put('/:id', {
        schema: updateCameraSchema,
        onRequest: [authMiddleware, requireAdmin],
        handler: updateCamera,
    });

    fastify.post('/:id/stream/refresh', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware, requireAdmin],
        handler: refreshCameraStream,
    });

    fastify.get('/:id/stream/events', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware],
        handler: getCameraSourceLifecycleEvents,
    });

    fastify.delete('/:id', {
        schema: cameraIdParamSchema,
        onRequest: [authMiddleware, requireAdmin],
        handler: deleteCamera,
    });

    // Bulk Export
    fastify.get('/export', {
        onRequest: [authMiddleware, requireAdmin],
        handler: exportCameras,
    });

    // Bulk Import
    fastify.post('/import', {
        onRequest: [authMiddleware, requireAdmin],
        handler: importCameras,
    });

    fastify.post('/import/preview', {
        onRequest: [authMiddleware, requireAdmin],
        handler: previewImportCameras,
    });

    fastify.post('/restore/preview', {
        onRequest: [authMiddleware, requireAdmin],
        handler: previewCameraRestore,
    });

    fastify.post('/restore/apply', {
        onRequest: [authMiddleware, requireAdmin],
        handler: applyCameraRestore,
    });

    // Bulk Update By Area
    fastify.patch('/bulk/area', {
        onRequest: [authMiddleware, requireAdmin],
        handler: bulkUpdateByArea,
    });

    // Bulk Delete By Area
    fastify.delete('/bulk/area/:areaId', {
        onRequest: [authMiddleware, requireAdmin],
        handler: bulkDeleteByArea,
    });
}
