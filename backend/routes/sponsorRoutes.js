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
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function sponsorRoutes(fastify, options) {
    // Public routes
    fastify.get('/active', getActiveSponsors);
    fastify.get('/cameras', getCamerasWithSponsors);

    // Protected routes (admin only) - Use authMiddleware instead of fingerprintAuthMiddleware
    fastify.get('/', {
        preHandler: authMiddleware
    }, getAllSponsors);

    fastify.get('/stats', {
        preHandler: authMiddleware
    }, getSponsorStats);

    fastify.get('/:id', {
        preHandler: authMiddleware
    }, getSponsorById);

    fastify.post('/', {
        preHandler: authMiddleware
    }, createSponsor);

    fastify.put('/:id', {
        preHandler: authMiddleware
    }, updateSponsor);

    fastify.delete('/:id', {
        preHandler: authMiddleware
    }, deleteSponsor);

    // Camera-sponsor assignment
    fastify.post('/camera/:cameraId/assign', {
        preHandler: authMiddleware
    }, assignSponsorToCamera);

    fastify.delete('/camera/:cameraId/remove', {
        preHandler: authMiddleware
    }, removeSponsorFromCamera);
}
