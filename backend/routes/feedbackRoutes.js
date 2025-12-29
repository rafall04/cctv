import { 
    createFeedback, 
    getAllFeedbacks, 
    updateFeedbackStatus, 
    deleteFeedback,
    getFeedbackStats 
} from '../controllers/feedbackController.js';
import authMiddleware from '../middleware/authMiddleware.js';

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

    // Admin endpoints
    fastify.get('/', { preHandler: [authMiddleware] }, getAllFeedbacks);
    fastify.get('/stats', { preHandler: [authMiddleware] }, getFeedbackStats);
    fastify.patch('/:id/status', { preHandler: [authMiddleware] }, updateFeedbackStatus);
    fastify.delete('/:id', { preHandler: [authMiddleware] }, deleteFeedback);
}
