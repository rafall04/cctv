/**
 * Sponsor Routes
 * Endpoints untuk sponsor management
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
import { fingerprintAuthMiddleware } from '../middleware/fingerprintValidator.js';

export default async function sponsorRoutes(fastify, options) {
    // Public routes
    fastify.get('/active', getActiveSponsors);
    fastify.get('/cameras', getCamerasWithSponsors);

    // Protected routes (admin only)
    fastify.get('/', {
        preHandler: fingerprintAuthMiddleware
    }, getAllSponsors);

    fastify.get('/stats', {
        preHandler: fingerprintAuthMiddleware
    }, getSponsorStats);

    fastify.get('/:id', {
        preHandler: fingerprintAuthMiddleware
    }, getSponsorById);

    fastify.post('/', {
        preHandler: fingerprintAuthMiddleware
    }, createSponsor);

    fastify.put('/:id', {
        preHandler: fingerprintAuthMiddleware
    }, updateSponsor);

    fastify.delete('/:id', {
        preHandler: fingerprintAuthMiddleware
    }, deleteSponsor);

    // Camera-sponsor assignment
    fastify.post('/camera/:cameraId/assign', {
        preHandler: fingerprintAuthMiddleware
    }, assignSponsorToCamera);

    fastify.delete('/camera/:cameraId/remove', {
        preHandler: fingerprintAuthMiddleware
    }, removeSponsorFromCamera);
}
