import { getDashboardStats } from '../controllers/adminController.js';
import { generateApiKey, listApiKeys, deleteApiKey } from '../controllers/apiKeyController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { createApiKeySchema, apiKeyIdParamSchema } from '../middleware/schemaValidators.js';

export default async function adminRoutes(fastify, options) {
    // Dashboard stats
    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getDashboardStats,
    });

    // API Key Management Endpoints
    // POST /api/admin/api-keys - Generate new API key
    fastify.post('/api-keys', {
        schema: createApiKeySchema,
        onRequest: [authMiddleware],
        handler: generateApiKey,
    });

    // GET /api/admin/api-keys - List active API keys
    fastify.get('/api-keys', {
        onRequest: [authMiddleware],
        handler: listApiKeys,
    });

    // DELETE /api/admin/api-keys/:id - Revoke API key
    fastify.delete('/api-keys/:id', {
        schema: apiKeyIdParamSchema,
        onRequest: [authMiddleware],
        handler: deleteApiKey,
    });
}
