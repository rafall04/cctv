/**
 * Purpose: Admin handlers for the Ronda Digital motion-detector settings (/api/admin/ronda).
 * Caller: routes/rondaAdminRoutes.js.
 * Deps: rondaConfigService.
 * MainFuncs: listRondaCameras, getRondaCamera, updateRondaCamera.
 */

import fs from 'fs';
import rondaConfigService from '../services/rondaConfigService.js';
import rondaDetectorService from '../services/rondaDetectorService.js';

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
            message: data.needsRestart
                ? 'Tersimpan. Beberapa pengaturan baru berlaku setelah kamera dinyalakan ulang.'
                : 'Tersimpan. Berlaku dalam ±15 detik tanpa restart.',
            data,
        });
    } catch (error) {
        return sendError(reply, error, 'Update ronda camera error');
    }
}

export async function listAvailableCameras(request, reply) {
    try {
        return reply.send({ success: true, data: rondaDetectorService.listAvailableCameras() });
    } catch (error) {
        return sendError(reply, error, 'List available ronda cameras error');
    }
}

export async function createRondaCamera(request, reply) {
    try {
        const data = await rondaDetectorService.createDetector(request.body || {});
        return reply.code(201).send({ success: true, message: 'Kamera ditambahkan dan mulai memantau.', data });
    } catch (error) {
        return sendError(reply, error, 'Create ronda camera error');
    }
}

export async function restartRondaCamera(request, reply) {
    try {
        const data = await rondaDetectorService.restartDetector(request.params.name);
        return reply.send({ success: true, message: 'Kamera dinyalakan ulang.', data });
    } catch (error) {
        return sendError(reply, error, 'Restart ronda camera error');
    }
}

export async function deleteRondaCamera(request, reply) {
    try {
        const data = await rondaDetectorService.removeDetector(request.params.name);
        return reply.send({ success: true, message: 'Kamera dihentikan dan dihapus dari pemantauan.', data });
    } catch (error) {
        return sendError(reply, error, 'Delete ronda camera error');
    }
}

export async function getRondaPreview(request, reply) {
    try {
        const file = rondaDetectorService.previewFile(request.params.name);
        return reply
            .header('Content-Type', 'image/jpeg')
            .header('Cache-Control', 'no-store')
            .send(fs.createReadStream(file));
    } catch (error) {
        return sendError(reply, error, 'Ronda preview error');
    }
}
