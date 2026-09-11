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
import { checkRateLimit } from '../middleware/rateLimiter.js';

// Per-TOKEN anti-amplification ceiling. The generic limiter already caps this route at 100/min per
// CF-Connecting-IP, but a single community share-link fanned across many IPs is not bounded per token.
// This is a COARSE amplification ceiling, NOT a bandwidth control: reaching it needs ~50+ IPs (each
// already ≤100/min), so a genuine viral crowd never trips it while a botnet turning one link into a
// re-streaming service does. The real bandwidth limits remain the per-IP cap + the box→Telegram pipe.
// Tunable via env; default deliberately high so legitimate use is never throttled.
const ARCHIVE_TOKEN_MAX_PER_MIN = Number.parseInt(process.env.ARCHIVE_TOKEN_MAX_PER_MIN, 10) > 0
    ? Number.parseInt(process.env.ARCHIVE_TOKEN_MAX_PER_MIN, 10)
    : 5000;

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

            // Per-token backstop — AFTER the access gate on purpose: only a request bearing a valid
            // token for this segment can fill that token's bucket, so nobody can grief a victim token
            // by hammering the endpoint with a guessed id. Keyed by the token PK (not the IP), it is
            // additive to the per-IP limiter — both must pass.
            const tokenGate = checkRateLimit(`archive-token:${allowed.tokenId}`, ARCHIVE_TOKEN_MAX_PER_MIN, 60000);
            if (!tokenGate.allowed) {
                reply.header('Retry-After', tokenGate.retryAfter);
                return reply.code(429).send({
                    success: false,
                    message: 'Terlalu banyak permintaan untuk tautan ini. Coba lagi sebentar lagi.',
                    retryAfter: tokenGate.retryAfter,
                });
            }

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
