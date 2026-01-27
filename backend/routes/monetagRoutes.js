import { 
    getMonetagSettingsHandler, 
    updateMonetagSettingsHandler,
    getPublicMonetagConfigHandler
} from '../controllers/monetagController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateMonetagSettings } from '../middleware/schemaValidators.js';

export default async function monetagRoutes(fastify, options) {
    // Public endpoint - Get Monetag config
    fastify.get('/config', getPublicMonetagConfigHandler);

    // Admin endpoints - Require authentication
    fastify.get('/settings', { 
        preHandler: [authMiddleware] 
    }, getMonetagSettingsHandler);

    fastify.put('/settings', { 
        preHandler: [authMiddleware, validateMonetagSettings] 
    }, updateMonetagSettingsHandler);
}
