/**
 * Purpose: Register public growth endpoints for area pages, discovery, and trending CCTV.
 * Caller: backend/server.js route bootstrap.
 * Deps: publicGrowthController and cacheMiddleware.
 * MainFuncs: publicGrowthRoutes.
 * SideEffects: Adds public cached read-only Fastify routes.
 */

import {
    getPublicArea,
    getPublicAreaCameras,
    getPublicDiscovery,
    getPublicTrendingCameras,
} from '../controllers/publicGrowthController.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';

export default async function publicGrowthRoutes(fastify) {
    fastify.get('/discovery', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicDiscovery,
    });

    fastify.get('/areas/:slug', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicArea,
    });

    fastify.get('/areas/:slug/cameras', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicAreaCameras,
    });

    fastify.get('/trending-cameras', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicTrendingCameras,
    });
}
