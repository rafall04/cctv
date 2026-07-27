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
import archiveLibrary from '../services/telegramArchiveLibraryService.js';

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

    // ---- Archive library: read what was uploaded, and play it back through US ------------------
    // The stream is proxied on purpose. A Telegram file URL embeds the bot token and is fetchable
    // by anyone holding the string, so handing one to a browser would leak the token AND give
    // unrestricted access to every archived recording.

    fastify.get('/library', { onRequest: guard }, async (request, reply) => {
        const { cameraId, status, limit, offset } = request.query || {};
        const data = archiveLibrary.listUploads({
            cameraId: cameraId ? Number(cameraId) : null,
            status: status || 'ok',
            limit: limit ? Number(limit) : 100,
            offset: offset ? Number(offset) : 0,
        });
        return reply.send({ success: true, data });
    });

    fastify.get('/library/summary', { onRequest: guard }, async (request, reply) => {
        return reply.send({ success: true, data: archiveLibrary.getSummary() });
    });

    fastify.get('/library/:segmentId/stream', {
        onRequest: guard,
        schema: {
            params: {
                type: 'object',
                required: ['segmentId'],
                properties: { segmentId: { type: 'integer', minimum: 1 } },
            },
        },
    }, async (request, reply) => {
        try {
            const { stream, size, filename } = await archiveLibrary.openSegmentStream(
                Number(request.params.segmentId),
            );
            reply.header('Content-Type', 'video/mp4');
            if (size) reply.header('Content-Length', String(size));
            // inline: the archive page plays it in place; a download is still one click away.
            reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);
            return reply.send(stream);
        } catch (error) {
            const code = error.statusCode || 500;
            return reply.code(code).send({
                success: false,
                message: code === 500 ? 'Internal server error' : error.message,
            });
        }
    });
}
