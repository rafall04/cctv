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
    // Penghitung menulis tiap detik. Cache dipendekkan ke 2 detik supaya angka di layar
    // terasa mengikuti video yang sedang ditonton — panel ini dinilai orang dengan cara
    // mencocokkannya ke kendaraan yang lewat, jadi jeda yang terasa merusak kepercayaan.
    // Pembacaannya tetap satu berkas kecil, jadi biayanya tak berarti.
    fastify.get('/vehicle-count/:cameraId', {
        preHandler: cacheMiddleware(2000),
        handler: getVehicleCount,
    });
}
