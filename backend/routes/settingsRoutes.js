import { getAllSettings, getSetting, updateSetting, getMapDefaultCenter } from '../controllers/settingsController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function settingsRoutes(fastify, options) {
    // Public route - get map default center
    fastify.get('/api/settings/map-center', getMapDefaultCenter);

    // Protected routes - require authentication
    fastify.get('/api/settings', { onRequest: [authMiddleware] }, getAllSettings);
    fastify.get('/api/settings/:key', { onRequest: [authMiddleware] }, getSetting);
    fastify.put('/api/settings/:key', { onRequest: [authMiddleware] }, updateSetting);
}
