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
        const data = getPublicVehicleCount(request.params.cameraId);
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
