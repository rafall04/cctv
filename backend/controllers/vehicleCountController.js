/**
 * Purpose: Handle the public vehicle-count API response for the showcase camera.
 * Caller: backend/routes/vehicleCountRoutes.js, mounted under /api/public.
 * Deps: vehicleCountService.
 * MainFuncs: getVehicleCount.
 * SideEffects: Reads sanitized counter telemetry.
 */

import { getPublicVehicleCount } from '../services/vehicleCountService.js';

export async function getVehicleCount(request, reply) {
    try {
        // `pada` = jam frame yang sedang ditonton (dihitung frontend dari tepi siaran dikurangi
        // jarak penonton ke tepi). Kosong = pakai angka terkini.
        const data = getPublicVehicleCount(request.params.cameraId, {
            pada: String(request.query?.pada || '').slice(0, 40),
        });
        return reply.send({ success: true, data });
    } catch (error) {
        const statusCode = error.statusCode || 500;
        if (statusCode === 500) console.error('Get vehicle count error:', error);
        return reply.code(statusCode).send({
            success: false,
            message: statusCode === 500 ? 'Internal server error' : error.message,
        });
    }
}
