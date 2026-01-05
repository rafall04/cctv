import { getAllSettings, getSetting, updateSetting, getMapDefaultCenter } from '../controllers/settingsController.js';

export default async function settingsRoutes(fastify, options) {
    // Public route - get map default center
    fastify.get('/api/settings/map-center', getMapDefaultCenter);

    // Protected routes - require authentication
    fastify.get('/api/settings', { preHandler: [fastify.authenticate] }, getAllSettings);
    fastify.get('/api/settings/:key', { preHandler: [fastify.authenticate] }, getSetting);
    fastify.put('/api/settings/:key', { preHandler: [fastify.authenticate] }, updateSetting);
}
