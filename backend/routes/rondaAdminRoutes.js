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
    fastify.get('/cameras/:name', { onRequest: guard, schema: nameParamSchema }, getRondaCamera);
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
                },
                additionalProperties: false,
            },
        },
    }, updateRondaCamera);
}
