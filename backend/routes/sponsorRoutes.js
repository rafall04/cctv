/*
Purpose: Register sponsor CRUD + camera assignment endpoints with auth + schema.
Caller: backend/server.js, mounted under /api/sponsors.
Deps: sponsorController, authMiddleware/requireAdmin, schemaValidators.
MainFuncs: sponsorRoutes.
SideEffects: Adds public sponsor list/camera routes and admin-only management routes to Fastify.
*/

import {
    getAllSponsors,
    getActiveSponsors,
    getSponsorById,
    createSponsor,
    updateSponsor,
    deleteSponsor,
    getSponsorStats,
    assignSponsorToCamera,
    removeSponsorFromCamera,
    getCamerasWithSponsors
} from '../controllers/sponsorController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import {
    createSponsorSchema,
    updateSponsorSchema,
    assignSponsorToCameraSchema,
} from '../middleware/schemaValidators.js';

export default async function sponsorRoutes(fastify, options) {
    // Public routes — read-only, unauthenticated.
    //
    // This comment used to read "both filter to enabled cameras only, so they cannot leak
    // admin-only metadata". That was false and it was load-bearing: `enabled` was never the
    // dangerous axis, and behind it getCamerasWithSponsors ran `SELECT * FROM cameras` with no
    // camera_class filter — so the first camera given a sponsor would have published its
    // private_rtsp_url and stream_key here, and a sponsored owner_private camera would have
    // appeared on a public surface outright. The query now names its columns and filters to
    // community; see the WHY in sponsorService.getCamerasWithSponsors.
    //
    // The rule for anything added below this line: a public handler owes an explicit column
    // list and the community filter. Do not restate that it is safe — make it safe, and let the
    // query say so.
    fastify.get('/active', getActiveSponsors);
    fastify.get('/cameras', getCamerasWithSponsors);

    // Admin-only reads. The full sponsor list, stats, and per-sponsor detail
    // include `price`, `contact_email`, and `contact_phone` — PII + revenue
    // figures that a viewer-role user must not see. Previously these routes
    // only required `authMiddleware` (any role).
    fastify.get('/', {
        preHandler: [authMiddleware, requireAdmin]
    }, getAllSponsors);

    fastify.get('/stats', {
        preHandler: [authMiddleware, requireAdmin]
    }, getSponsorStats);

    fastify.get('/:id', {
        preHandler: [authMiddleware, requireAdmin]
    }, getSponsorById);

    fastify.post('/', {
        preHandler: [authMiddleware, requireAdmin],
        schema: createSponsorSchema,
    }, createSponsor);

    fastify.put('/:id', {
        preHandler: [authMiddleware, requireAdmin],
        schema: updateSponsorSchema,
    }, updateSponsor);

    fastify.delete('/:id', {
        preHandler: [authMiddleware, requireAdmin]
    }, deleteSponsor);

    // Camera-sponsor assignment
    fastify.post('/camera/:cameraId/assign', {
        preHandler: [authMiddleware, requireAdmin],
        schema: assignSponsorToCameraSchema,
    }, assignSponsorToCamera);

    fastify.delete('/camera/:cameraId/remove', {
        preHandler: [authMiddleware, requireAdmin]
    }, removeSponsorFromCamera);
}
