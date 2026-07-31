/**
 * Purpose: Serve ONE archived (Telegram) recording segment to a public playback-token holder.
 * Caller: server.js, mounted at /api/playback-archive.
 * Deps: publicArchiveAccessService (the decision), telegramArchiveLibraryService (the bytes).
 * MainFuncs: publicArchiveRoutes.
 *
 * Deliberately a single capability. The admin archive surface (listing, summary, routing config,
 * upload activity) stays behind requireAdmin; nothing here can reach it.
 *
 * The stream is proxied through us and never redirected: a Telegram file URL embeds the bot token,
 * so handing one to a browser would leak the token AND grant unrestricted access to every archived
 * recording — not just the segment the visitor paid for.
 */

import publicArchiveAccessService from '../services/publicArchiveAccessService.js';
import archiveLibrary from '../services/telegramArchiveLibraryService.js';

export default async function publicArchiveRoutes(fastify) {
    fastify.get('/:segmentId/stream', {
        schema: {
            params: {
                type: 'object',
                required: ['segmentId'],
                properties: { segmentId: { type: 'integer', minimum: 1 } },
            },
        },
    }, async (request, reply) => {
        try {
            // Every gate lives here. Nothing below runs unless this returns.
            const allowed = publicArchiveAccessService.resolveSegmentForRequest(
                request.params.segmentId,
                request
            );

            const requested = archiveLibrary.parseRange(request.headers.range, allowed.fileSize);
            const { stream, size, filename, range, totalSize } =
                await archiveLibrary.openSegmentStream(allowed.segmentId, requested);

            reply.header('Content-Type', 'video/mp4');
            reply.header('Accept-Ranges', 'bytes');
            // private: this response is authorised for ONE token holder and must never be shared by
            // a proxy or CDN with the next visitor.
            reply.header('Cache-Control', 'private, max-age=3600');
            reply.header('Content-Disposition', `inline; filename="${String(filename).replace(/"/g, '')}"`);

            if (range && totalSize) {
                reply.code(206);
                reply.header('Content-Range', `bytes ${range.start}-${range.end}/${totalSize}`);
            }
            if (size) reply.header('Content-Length', String(size));

            return reply.send(stream);
        } catch (error) {
            const code = error.statusCode || 500;
            if (code === 500) console.error('[PublicArchive] stream error:', error);
            return reply.code(code).send({
                success: false,
                message: code === 500 ? 'Internal server error' : error.message,
            });
        }
    });
}
