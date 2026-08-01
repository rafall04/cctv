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
        const { cameraId, status, limit, offset, from, to } = request.query || {};
        const filters = {
            cameraId: cameraId ? Number(cameraId) : null,
            status: status || 'ok',
            // ISO-8601 UTC bounds over recorded_at. The browser converts the operator's local date
            // into these, so a WIB day means a WIB day rather than a UTC one.
            from: from || null,
            to: to || null,
        };
        const requestedLimit = limit ? Number(limit) : 100;
        const requestedOffset = offset ? Number(offset) : 0;
        const data = archiveLibrary.listUploads({
            ...filters,
            limit: requestedLimit,
            offset: requestedOffset,
        });
        // `total` is what lets the page know more rows exist. Reporting only the page would leave
        // the UI unable to tell "that is everything" from "that is the first 100 of 5,032".
        return reply.send({
            success: true,
            data,
            meta: {
                total: archiveLibrary.countUploads(filters),
                limit: requestedLimit,
                offset: requestedOffset,
            },
        });
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
            /*
             * Range support is what makes the player seekable. Without `Accept-Ranges` and a 206,
             * a browser can only ever fetch the file from byte zero — so dragging the scrubber or
             * skipping 10 seconds silently did nothing. The player asks; the server has to answer.
             */
            const segmentId = Number(request.params.segmentId);
            const meta = archiveLibrary.getUpload(segmentId);
            const requested = archiveLibrary.parseRange(request.headers.range, meta.file_size);

            const { stream, size, filename, range, totalSize } =
                await archiveLibrary.openSegmentStream(segmentId, requested);

            reply.header('Content-Type', 'video/mp4');
            reply.header('Accept-Ranges', 'bytes');
            // Archive segments never change once written, so let the browser keep what it fetched.
            reply.header('Cache-Control', 'private, max-age=3600');
            reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '')}"`);

            if (range && totalSize) {
                reply.code(206);
                reply.header('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
            }
            if (size) reply.header('Content-Length', String(size));

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
