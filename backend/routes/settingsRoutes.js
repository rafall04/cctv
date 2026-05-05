/**
 * Purpose: Register public and protected settings endpoints for runtime UI configuration.
 * Caller: backend/server.js route bootstrap.
 * Deps: settingsController handlers and authMiddleware.
 * MainFuncs: settingsRoutes.
 * SideEffects: Adds Fastify routes for public settings reads and authenticated settings mutations.
 */

import {
    getAllSettings,
    getSetting,
    updateSetting,
    getMapDefaultCenter,
    getLandingPageSettings,
    getPublicAdsSettings,
    getPublicTimezone,
} from '../controllers/settingsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function settingsRoutes(fastify, options) {
    // Public routes
    fastify.get('/api/settings/map-center', getMapDefaultCenter);
    fastify.get('/api/settings/landing-page', getLandingPageSettings);
    fastify.get('/api/settings/public-ads', getPublicAdsSettings);
    fastify.get('/api/settings/timezone', getPublicTimezone);

    // Protected routes - require authentication
    fastify.get('/api/settings', { onRequest: [authMiddleware] }, getAllSettings);
    fastify.get('/api/settings/:key', { onRequest: [authMiddleware] }, getSetting);
    fastify.put('/api/settings/:key', { onRequest: [authMiddleware] }, updateSetting);
}
