import { 
    getMonetagSettingsHandler, 
    updateMonetagSettingsHandler,
    getPublicMonetagConfigHandler
} from '../controllers/monetagController.js';
import { authenticateToken } from '../middleware/authMiddleware.js';
import { validateMonetagSettings } from '../middleware/schemaValidators.js';

export default async function monetagRoutes(fastify, options) {
    // Public endpoint - Get Monetag config
    fastify.get('/config', getPublicMonetagConfigHandler);

    // Admin endpoints - Require authentication
    fastify.get('/settings', { 
        preHandler: [authenticateToken] 
    }, getMonetagSettingsHandler);

    fastify.put('/settings', { 
        preHandler: [authenticateToken, validateMonetagSettings] 
    }, updateMonetagSettingsHandler);
}
