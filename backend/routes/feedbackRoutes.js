import { 
    createFeedback, 
    getAllFeedbacks, 
    updateFeedbackStatus, 
    deleteFeedback,
    getFeedbackStats 
} from '../controllers/feedbackController.js';
import authMiddleware, { requireAdmin } from '../middleware/authMiddleware.js';

export default async function feedbackRoutes(fastify) {
    // Public endpoint - submit feedback
    fastify.post('/', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string', maxLength: 100 },
                    email: { type: 'string', format: 'email', maxLength: 100 },
                    message: { type: 'string', minLength: 10, maxLength: 1000 },
                },
                required: ['message'],
            },
        },
    }, createFeedback);

    // Admin endpoints — reads carry submitter name/email (PII) + revenue-adjacent stats,
    // so they need requireAdmin like PATCH/DELETE, not bare authMiddleware (viewer is staff).
    fastify.get('/', { onRequest: [authMiddleware, requireAdmin] }, getAllFeedbacks);
    fastify.get('/stats', { onRequest: [authMiddleware, requireAdmin] }, getFeedbackStats);
    fastify.patch('/:id/status', { preHandler: [authMiddleware, requireAdmin] }, updateFeedbackStatus);
    fastify.delete('/:id', { preHandler: [authMiddleware, requireAdmin] }, deleteFeedback);
}
