import { getDashboardStats } from '../controllers/adminController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function adminRoutes(fastify, options) {
    fastify.get('/stats', {
        onRequest: [authMiddleware],
        handler: getDashboardStats,
    });
}
