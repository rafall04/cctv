import { getDashboardStats } from '../controllers/adminController.js';
import { generateApiKey, listApiKeys, deleteApiKey } from '../controllers/apiKeyController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';
import { createApiKeySchema, apiKeyIdParamSchema } from '../middleware/schemaValidators.js';
import mediaMtxService from '../services/mediaMtxService.js';

export default async function adminRoutes(fastify, options) {
    // Dashboard stats
    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getDashboardStats,
    });

    // Debug endpoint - raw MediaMTX data (for troubleshooting viewer count)
    fastify.get('/debug/mediamtx-readers', {
        onRequest: [authMiddleware],
        handler: async (request, reply) => {
            try {
                const axios = (await import('axios')).default;
                const pathsRes = await axios.get('http://localhost:9997/v3/paths/list', { timeout: 5000 });
                const paths = pathsRes.data?.items || [];
                
                // Get raw readers data for debugging
                const rawData = paths.map(path => ({
                    name: path.name,
                    ready: path.ready,
                    sourceReady: path.sourceReady,
                    readers: path.readers || [],
                    readerCount: (path.readers || []).length
                }));
                
                // Get filtered stats
                const filteredStats = await mediaMtxService.getStats(true);
                
                return reply.send({
                    success: true,
                    raw: rawData,
                    filtered: {
                        totalSessions: filteredStats.sessions.length,
                        paths: filteredStats.paths.map(p => ({
                            name: p.name,
                            originalReaders: p._originalReaderCount,
                            filteredReaders: p._filteredReaderCount,
                            readers: p.readers
                        }))
                    }
                });
            } catch (error) {
                return reply.code(500).send({
                    success: false,
                    message: error.message
                });
            }
        }
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
