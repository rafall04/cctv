/**
 * Purpose: Register the public per-camera feedback endpoints (one-tap verdict).
 * Caller: server.js, mounted at /api/public/cameras.
 * Deps: cameraReactionController.
 * MainFuncs: publicCameraFeedbackRoutes.
 *
 * Public and unauthenticated by design — the whole point is that a visitor with no account can
 * answer. What keeps it safe is not auth but shape: the vote is a single enum, the camera must be
 * `community`, and the primary key on (camera_id, device_hash) means a flood of taps still leaves
 * exactly one row.
 */

import { getCameraReaction, setCameraReaction } from '../controllers/cameraReactionController.js';
import { getReportCategories, submitCameraReport } from '../controllers/cameraReportController.js';

const cameraIdParams = {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'integer', minimum: 1 } },
};

export default async function publicCameraFeedbackRoutes(fastify) {
    fastify.get('/:id/reaction', { schema: { params: cameraIdParams } }, getCameraReaction);

    fastify.post('/:id/reaction', {
        schema: {
            params: cameraIdParams,
            body: {
                type: 'object',
                required: ['value'],
                // Enumerated at the edge as well as in the service: a body that cannot express an
                // invalid vote is one less thing the service has to be trusted about.
                properties: { value: { type: 'integer', enum: [1, -1, 0] } },
                additionalProperties: false,
            },
        },
    }, setCameraReaction);

    /*
     * Static and identical for everyone, so it is the one route here that may be cached. Declared
     * before `/:id/report` would be ambiguous only if a camera could be named "report-categories";
     * ids are integers, so the schema keeps them apart.
     */
    fastify.get('/report-categories', getReportCategories);

    fastify.post('/:id/report', {
        schema: {
            params: cameraIdParams,
            body: {
                type: 'object',
                required: ['category'],
                properties: {
                    category: { type: 'string', maxLength: 16 },
                    message: { type: ['string', 'null'], maxLength: 500 },
                    // Free-form on purpose: the browser's datetime-local gives a local wall-clock
                    // string, and coercing it to an instant here would silently move an incident by
                    // the visitor's offset. The operator reads it as the reporter wrote it.
                    occurredAt: { type: ['string', 'null'], maxLength: 32 },
                },
                additionalProperties: false,
            },
        },
    }, submitCameraReport);
}
