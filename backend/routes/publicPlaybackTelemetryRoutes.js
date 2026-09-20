/**
 * Purpose: Anonymous playback-failure telemetry from viewers' browsers.
 * Caller: server.js, mounted at /api/public/playback-telemetry.
 * Deps: playbackTelemetryService.
 * MainFuncs: publicPlaybackTelemetryRoutes.
 *
 * Public and unauthenticated by design — the visitor whose playback failed usually has no
 * session at all. Abuse is bounded three ways: the global public rate limiter, the strict
 * body schema below (a few small fields, no free text beyond 200 chars), and an in-memory
 * ring that cannot grow the database. The response is identical for every well-formed
 * report — nothing here confirms or denies that a cameraId exists.
 */

import playbackTelemetryService from '../services/playbackTelemetryService.js';

export default async function publicPlaybackTelemetryRoutes(fastify) {
    fastify.post('/', {
        schema: {
            body: {
                type: 'object',
                required: ['stage'],
                properties: {
                    // Where in the pipeline it failed — the actionable dimension.
                    stage: { type: 'string', enum: ['source_load', 'seek_stall', 'buffer_stall', 'unknown'] },
                    // Classified client error ('codec' | 'network' | 'stalled' | 'media_err_N').
                    errorCode: { type: 'string', maxLength: 64 },
                    cameraId: { type: 'integer', minimum: 1 },
                    scope: { type: 'string', enum: ['public_preview', 'token_full', 'owner_full', 'admin_full'] },
                    // Segment filename only — a corrupt file reported by many viewers is the signal.
                    segment: { type: 'string', maxLength: 128 },
                    detail: { type: 'string', maxLength: 200 },
                },
                additionalProperties: false,
            },
        },
    }, async (request, reply) => {
        playbackTelemetryService.record(request.body);
        return reply.code(202).send({ success: true });
    });
}
