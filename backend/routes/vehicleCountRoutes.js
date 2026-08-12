/**
 * Purpose: Register the public vehicle-count endpoint for the showcase camera.
 * Caller: backend/server.js route bootstrap.
 * Deps: vehicleCountController and cacheMiddleware.
 * MainFuncs: vehicleCountRoutes.
 * SideEffects: Adds one public cached read-only Fastify route.
 */

import { getVehicleCount } from '../controllers/vehicleCountController.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';

export default async function vehicleCountRoutes(fastify) {
    // Penghitung menulis tiap detik; cache 5 detik sudah memotong hampir semua pembacaan
    // berkas tanpa membuat angka terasa tertinggal di layar pengunjung.
    fastify.get('/vehicle-count/:cameraId', {
        preHandler: cacheMiddleware(5000),
        handler: getVehicleCount,
    });
}
