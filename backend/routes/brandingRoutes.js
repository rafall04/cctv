import {
    getBrandingSettings,
    getBrandingSettingsAdmin,
    updateBrandingSetting,
    bulkUpdateBrandingSettings,
    resetBrandingSettings,
} from '../controllers/brandingController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function brandingRoutes(fastify, options) {
    // Public endpoint - no auth required
    fastify.get('/public', getBrandingSettings);
    
    // Admin endpoints - auth required
    fastify.get('/admin', { preHandler: authMiddleware }, getBrandingSettingsAdmin);
    fastify.put('/:key', { preHandler: authMiddleware }, updateBrandingSetting);
    fastify.post('/bulk', { preHandler: authMiddleware }, bulkUpdateBrandingSettings);
    fastify.post('/reset', { preHandler: authMiddleware }, resetBrandingSettings);
}
