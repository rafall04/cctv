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
}
