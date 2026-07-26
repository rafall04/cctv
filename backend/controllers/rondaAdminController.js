/**
 * Purpose: Admin handlers for the Ronda Digital motion-detector settings (/api/admin/ronda).
 * Caller: routes/rondaAdminRoutes.js.
 * Deps: rondaConfigService.
 * MainFuncs: listRondaCameras, getRondaCamera, updateRondaCamera.
 */

import rondaConfigService from '../services/rondaConfigService.js';

function sendError(reply, error, label) {
    console.error(`${label}:`, error);
    const code = error.statusCode || 500;
    return reply.code(code).send({
        success: false,
        message: code === 500 ? 'Internal server error' : error.message,
    });
}

export async function listRondaCameras(request, reply) {
    try {
        const cameras = rondaConfigService.listCameras();
        // `available: false` lets the UI explain the detectors aren't installed on this host
        // instead of showing an empty list that looks like a bug.
        return reply.send({
            success: true,
            data: { available: rondaConfigService.isAvailable(), cameras },
        });
    } catch (error) {
        return sendError(reply, error, 'List ronda cameras error');
    }
}

export async function getRondaCamera(request, reply) {
    try {
        return reply.send({ success: true, data: rondaConfigService.getCamera(request.params.name) });
    } catch (error) {
        return sendError(reply, error, 'Get ronda camera error');
    }
}

export async function updateRondaCamera(request, reply) {
    try {
        const data = rondaConfigService.updateCamera(request.params.name, request.body || {});
        return reply.send({
            success: true,
            message: 'Tersimpan. Berlaku dalam ±15 detik tanpa restart.',
            data,
        });
    } catch (error) {
        return sendError(reply, error, 'Update ronda camera error');
    }
}
