/**
 * Purpose: Register admin endpoints for per-camera vehicle-counting settings.
 * Caller: backend/server.js route bootstrap.
 * Deps: vehicleCountAdminController, auth middleware.
 * MainFuncs: vehicleCountAdminRoutes.
 * SideEffects: Adds admin-only routes that write counting config files.
 */

import {
    getCountCamera,
    listAvailableCameras,
    listCountCameras,
    removeCountCamera,
    saveCountCamera,
} from '../controllers/vehicleCountAdminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const idParam = {
    params: {
        type: 'object',
        required: ['cameraId'],
        properties: { cameraId: { type: 'integer', minimum: 1 } },
    },
};

// Skema badan ditulis lengkap dengan sengaja: field yang TIDAK terdaftar akan DIHAPUS oleh
// Fastify, bukan ditolak - jadi menambah setelan baru berarti menambahnya di sini juga,
// kalau tidak nilainya hilang diam-diam dan panel terlihat "tidak menyimpan".
const bodySchema = {
    body: {
        type: 'object',
        properties: {
            aktif: { type: 'boolean' },
            label: { type: 'string', maxLength: 120 },
            garis: {
                type: 'array',
                maxItems: 6,
                items: {
                    type: 'object',
                    properties: {
                        a: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
                        b: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
                        nama: { type: 'string', maxLength: 24 },
                    },
                },
            },
            arah_arus: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
            nama_arah: {
                type: 'object',
                properties: {
                    plus: { type: 'string', maxLength: 40 },
                    minus: { type: 'string', maxLength: 40 },
                },
            },
            model: { type: 'string', maxLength: 60 },
            imgsz: { type: 'number' },
            conf: { type: 'number' },
            conf_gambar: { type: 'number' },
            fps: { type: 'number' },
            min_gerak: { type: 'number' },
            min_umur: { type: 'number' },
        },
        additionalProperties: false,
    },
};

export default async function vehicleCountAdminRoutes(fastify) {
    const guard = [authMiddleware, requireAdmin];

    fastify.get('/cameras', { onRequest: guard }, listCountCameras);
    fastify.get('/available', { onRequest: guard }, listAvailableCameras);
    fastify.get('/cameras/:cameraId', { onRequest: guard, schema: idParam }, getCountCamera);
    fastify.put('/cameras/:cameraId', {
        onRequest: guard,
        schema: { ...idParam, ...bodySchema },
    }, saveCountCamera);
    fastify.delete('/cameras/:cameraId', { onRequest: guard, schema: idParam }, removeCountCamera);
}
