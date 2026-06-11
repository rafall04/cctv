import { login, logout, verifyToken, refreshTokens, register, registerInfo } from '../controllers/authController.js';
import { getCsrfToken } from '../controllers/csrfController.js';
import { fingerprintAuthMiddleware } from '../middleware/fingerprintValidator.js';
import { loginSchema, refreshTokenSchema, registerSchema } from '../middleware/schemaValidators.js';

export default async function authRoutes(fastify, options) {
    // CSRF token endpoint (public - needed before login)
    fastify.get('/csrf', getCsrfToken);

    // Login (public) - with schema validation
    fastify.post('/login', {
        schema: loginSchema,
        handler: login,
    });

    // Customer self-registration (public; can be disabled from the admin billing page)
    fastify.post('/register', {
        schema: registerSchema,
        handler: register,
    });

    fastify.get('/register-info', registerInfo);

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
