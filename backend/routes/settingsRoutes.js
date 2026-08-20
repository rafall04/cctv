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
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

export default async function settingsRoutes(fastify, options) {
    // Public routes
    fastify.get('/api/settings/map-center', getMapDefaultCenter);
    fastify.get('/api/settings/landing-page', getLandingPageSettings);
    fastify.get('/api/settings/public-ads', getPublicAdsSettings);
    fastify.get('/api/settings/timezone', getPublicTimezone);

    /*
     * Admin-only READS, not merely authenticated ones.
     *
     * `settings` is a credential-bearing table by design — telegramService writes the bot token
     * into the `telegram_config` row here — and getAllSettings is `SELECT * FROM settings` with no
     * masking of any kind between the query and the response. `/:key` is the sharper edge: a
     * caller can name `telegram_config` directly.
     *
     * These two used to require only a login while the PUT beside them required admin, so a
     * `viewer` account could read every secret it was not allowed to change. Every consumer in the
     * app is an adminOnly settings or billing panel, so the gate costs nothing. The four genuinely
     * public reads above stay public: each returns one narrow, deliberately-chosen slice.
     */
    fastify.get('/api/settings', { onRequest: [authMiddleware, requireAdmin] }, getAllSettings);
    fastify.get('/api/settings/:key', { onRequest: [authMiddleware, requireAdmin] }, getSetting);
    fastify.put('/api/settings/:key', { onRequest: [authMiddleware, requireAdmin] }, updateSetting);
}
