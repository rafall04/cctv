import { 
    createFeedback, 
    getAllFeedbacks, 
    updateFeedbackStatus, 
    deleteFeedback,
    getFeedbackStats 
} from '../controllers/feedbackController.js';
import { fingerprintAuthMiddleware } from '../middleware/authMiddleware.js';

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
    fastify.get('/', { preHandler: [fingerprintAuthMiddleware] }, getAllFeedbacks);
    fastify.get('/stats', { preHandler: [fingerprintAuthMiddleware] }, getFeedbackStats);
    fastify.patch('/:id/status', { preHandler: [fingerprintAuthMiddleware] }, updateFeedbackStatus);
    fastify.delete('/:id', { preHandler: [fingerprintAuthMiddleware] }, deleteFeedback);
}
