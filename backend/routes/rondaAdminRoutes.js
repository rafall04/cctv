/**
 * Purpose: Admin routes for Ronda Digital motion-detector settings under /api/admin/ronda (requireAdmin).
 * Caller: backend/server.js route bootstrap.
 * Deps: rondaAdminController, authMiddleware.
 * MainFuncs: rondaAdminRoutes.
 *
 * Bodies are schema-light on purpose: rondaConfigService validates ranges and the HH:MM-HH:MM window,
 * and silently ignores any key outside its editable whitelist.
 */

import {
    listRondaCameras,
    getRondaCamera,
    updateRondaCamera,
    listAvailableCameras,
    createRondaCamera,
    restartRondaCamera,
    deleteRondaCamera,
    getRondaPreview,
} from '../controllers/rondaAdminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const nameParamSchema = {
    params: {
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string', pattern: '^[A-Za-z0-9_-]+$' } },
    },
};

export default async function rondaAdminRoutes(fastify) {
    const guard = [authMiddleware, requireAdmin];

    fastify.get('/cameras', { onRequest: guard }, listRondaCameras);
    fastify.get('/available', { onRequest: guard }, listAvailableCameras);
    fastify.get('/cameras/:name', { onRequest: guard, schema: nameParamSchema }, getRondaCamera);
    fastify.get('/cameras/:name/preview.jpg', { onRequest: guard, schema: nameParamSchema }, getRondaPreview);

    fastify.post('/cameras', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['camera_id'],
                properties: {
                    camera_id: { type: 'integer' },
                    label: { type: 'string', maxLength: 80 },
                    area: { type: 'string', maxLength: 80 },
                    chat_id: { type: 'string', maxLength: 32 },
                    alert_hours: { type: 'string', maxLength: 11 },
                    tg_cooldown: { type: 'number' },
                    tg_cooldown_off: { type: 'number' },
                    min_area: { type: 'number' },
                    confirm_classes: { type: 'string', maxLength: 120 },
                    proc_w: { type: 'number' },
                    target_fps: { type: 'number' },
                },
                additionalProperties: false,
            },
        },
    }, createRondaCamera);

    fastify.post('/cameras/:name/restart', { onRequest: guard, schema: nameParamSchema }, restartRondaCamera);
    fastify.delete('/cameras/:name', { onRequest: guard, schema: nameParamSchema }, deleteRondaCamera);
    fastify.put('/cameras/:name', {
        onRequest: guard,
        schema: {
            ...nameParamSchema,
            body: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean' },
                    alert_hours: { type: 'string', maxLength: 11 },
                    tg_cooldown: { type: 'number' },
                    tg_cooldown_off: { type: 'number' },
                    chat_id: { type: 'string', maxLength: 32 },
                    min_area: { type: 'number' },
                    confirm_conf: { type: 'number' },
                    confirm_classes: { type: 'string', maxLength: 120 },
                    label: { type: 'string', maxLength: 80 },
                    area: { type: 'string', maxLength: 80 },
                    ignore: { type: 'array', maxItems: 12 },
                    roi: { type: 'array', maxItems: 40 },
                    proc_w: { type: 'number' },
                    target_fps: { type: 'number' },
                    crop_limit: { type: 'string', maxLength: 40 },
                    retention_days: { type: 'number' },
                    max_snaps: { type: 'number' },
                },
                additionalProperties: false,
            },
        },
    }, updateRondaCamera);
}
