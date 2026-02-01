import { getAllSettings, getSetting, updateSetting, getMapDefaultCenter, getLandingPageSettings } from '../controllers/settingsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function settingsRoutes(fastify, options) {
    // Public routes
    fastify.get('/api/settings/map-center', getMapDefaultCenter);
    fastify.get('/api/settings/landing-page', getLandingPageSettings);

    // Protected routes - require authentication
    fastify.get('/api/settings', { onRequest: [authMiddleware] }, getAllSettings);
    fastify.get('/api/settings/:key', { onRequest: [authMiddleware] }, getSetting);
    fastify.put('/api/settings/:key', { onRequest: [authMiddleware] }, updateSetting);
}
