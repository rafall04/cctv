/**
 * Purpose: Admin routes for Telegram recording-archive routing under /api/admin/telegram-archive (requireAdmin).
 * Caller: backend/server.js route bootstrap.
 * Deps: telegramArchiveController, authMiddleware.
 * MainFuncs: telegramArchiveRoutes.
 *
 * Bodies stay schema-light: telegramArchiveService owns the real validation (scope/chat-id shape,
 * camera and area existence, duplicate detection) so the messages stay operator-readable.
 */

import {
    getOverview,
    postRoute,
    putRoute,
    removeRoute,
    getActivity,
    postVerifyChat,
} from '../controllers/telegramArchiveController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const idParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^[a-z0-9][a-z0-9_-]{0,39}$' } },
    },
};

const routeBody = {
    type: 'object',
    properties: {
        enabled: { type: 'boolean' },
        scope: { type: 'string', enum: ['camera', 'area', 'all'] },
        cameraId: { type: 'integer' },
        areaId: { type: 'integer' },
        chatId: { type: 'string', maxLength: 24 },
        label: { type: 'string', maxLength: 80 },
    },
    additionalProperties: false,
};

export default async function telegramArchiveRoutes(fastify) {
    const guard = [authMiddleware, requireAdmin];

    fastify.get('/overview', { onRequest: guard }, getOverview);
    fastify.get('/activity', { onRequest: guard }, getActivity);

    fastify.post('/routes', {
        onRequest: guard,
        schema: { body: { ...routeBody, required: ['scope', 'chatId'] } },
    }, postRoute);

    fastify.put('/routes/:id', {
        onRequest: guard,
        schema: { ...idParamSchema, body: routeBody },
    }, putRoute);

    fastify.delete('/routes/:id', { onRequest: guard, schema: idParamSchema }, removeRoute);

    fastify.post('/verify-chat', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['chatId'],
                properties: { chatId: { type: 'string', maxLength: 24 } },
                additionalProperties: false,
            },
        },
    }, postVerifyChat);
}
