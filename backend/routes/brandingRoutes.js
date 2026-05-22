import {
    getBrandingSettings,
    getBrandingSettingsAdmin,
    updateBrandingSetting,
    bulkUpdateBrandingSettings,
    resetBrandingSettings,
} from '../controllers/brandingController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

export default async function brandingRoutes(fastify, options) {
    // Public endpoint - no auth required
    fastify.get('/public', getBrandingSettings);

    // Admin endpoints - auth required
    fastify.get('/admin', { preHandler: [authMiddleware] }, getBrandingSettingsAdmin);
    fastify.put('/:key', { preHandler: [authMiddleware, requireAdmin] }, updateBrandingSetting);
    fastify.post('/bulk', { preHandler: [authMiddleware, requireAdmin] }, bulkUpdateBrandingSettings);
    fastify.post('/reset', { preHandler: [authMiddleware, requireAdmin] }, resetBrandingSettings);
}
