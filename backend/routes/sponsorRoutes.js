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
    // Public routes — read-only. getActiveSponsors and getCamerasWithSponsors
    // both filter to enabled cameras only, so they cannot leak admin-only
    // metadata. Pricing and contact details only live on the admin endpoints.
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
