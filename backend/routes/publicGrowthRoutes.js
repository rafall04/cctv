/**
 * Purpose: Register public growth endpoints for area pages, discovery, trending CCTV, and vehicle counts.
 * Caller: backend/server.js route bootstrap.
 * Deps: publicGrowthController, vehicleCountRoutes, and cacheMiddleware.
 * MainFuncs: publicGrowthRoutes.
 * SideEffects: Adds public cached read-only Fastify routes.
 */

import {
    getPublicArea,
    getPublicAreaCameras,
    getPublicDiscovery,
    getPublicLcpCard,
    getPublicOgMeta,
    getPublicTrendingCameras,
} from '../controllers/publicGrowthController.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';
import vehicleCountRoutes from './vehicleCountRoutes.js';

export default async function publicGrowthRoutes(fastify) {
    // Didaftarkan di sini, bukan di server.js, supaya berkas bootstrap itu tetap di bawah
    // pagar ukuran 800 baris. Prefix /api/public sudah sama, jadi jalurnya tidak berubah.
    await fastify.register(vehicleCountRoutes);

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

    // SSI include target for index.html — text/html fragment, always 200 (see controller).
    fastify.get('/lcp-card', {
        handler: getPublicLcpCard,
    });

    // SSI include target for <head> share-preview tags — text/html fragment, always 200.
    fastify.get('/og-meta', {
        preHandler: cacheMiddleware(30000),
        handler: getPublicOgMeta,
    });
}
