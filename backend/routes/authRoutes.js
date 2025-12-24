import { login, logout, verifyToken } from '../controllers/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function authRoutes(fastify, options) {
    // Login (public)
    fastify.post('/login', login);

    // Logout (protected)
    fastify.post('/logout', {
        onRequest: [authMiddleware],
        handler: logout,
    });

    // Verify token (protected)
    fastify.get('/verify', {
        onRequest: [authMiddleware],
        handler: verifyToken,
    });
}
