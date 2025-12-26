import { login, logout, verifyToken, refreshTokens } from '../controllers/authController.js';
import { getCsrfToken } from '../controllers/csrfController.js';
import { fingerprintAuthMiddleware } from '../middleware/fingerprintValidator.js';
import { loginSchema, refreshTokenSchema } from '../middleware/schemaValidators.js';

export default async function authRoutes(fastify, options) {
    // CSRF token endpoint (public - needed before login)
    fastify.get('/csrf', getCsrfToken);

    // Login (public) - with schema validation
    fastify.post('/login', {
        schema: loginSchema,
        handler: login,
    });

    // Refresh tokens (public - uses refresh token for auth)
    fastify.post('/refresh', {
        schema: refreshTokenSchema,
        handler: refreshTokens,
    });

    // Logout (protected with fingerprint validation)
    fastify.post('/logout', {
        onRequest: [fingerprintAuthMiddleware],
        handler: logout,
    });

    // Verify token (protected with fingerprint validation)
    fastify.get('/verify', {
        onRequest: [fingerprintAuthMiddleware],
        handler: verifyToken,
    });
}
