import { 
    getSaweriaSettingsHandler, 
    updateSaweriaSettingsHandler,
    getPublicSaweriaConfigHandler
} from '../controllers/saweriaController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { validateSaweriaSettings } from '../middleware/schemaValidators.js';

export default async function saweriaRoutes(fastify, options) {
    // Public endpoint - Get Saweria config
    fastify.get('/config', getPublicSaweriaConfigHandler);

    // Admin endpoints - Require authentication
    fastify.get('/settings', { 
        preHandler: [authMiddleware] 
    }, getSaweriaSettingsHandler);

    fastify.put('/settings', { 
        preHandler: [authMiddleware, validateSaweriaSettings] 
    }, updateSaweriaSettingsHandler);
}
