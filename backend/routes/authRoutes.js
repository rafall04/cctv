import { login, logout, verifyToken, refreshTokens, register, registerInfo, verifyTotp, enrollTotpSetup, enrollTotpConfirm } from '../controllers/authController.js';
import { getCsrfToken } from '../controllers/csrfController.js';
import { fingerprintAuthMiddleware } from '../middleware/fingerprintValidator.js';
import { loginSchema, refreshTokenSchema, registerSchema } from '../middleware/schemaValidators.js';
import { totpVerifySchema, totpEnrollSetupSchema, totpEnrollConfirmSchema } from '../middleware/totpSchemas.js';

export default async function authRoutes(fastify, options) {
    // CSRF token endpoint (public - needed before login)
    fastify.get('/csrf', getCsrfToken);

    // Login (public) - with schema validation
    fastify.post('/login', {
        schema: loginSchema,
        handler: login,
    });

    // Second-factor exchange (public — the pending JWT is the credential; the code
    // check + per-user lockout live in totpAuthService).
    fastify.post('/totp/verify', {
        schema: totpVerifySchema,
        handler: verifyTotp,
    });

    // Mandatory-admin enrollment (public — the enroll-only JWT is the credential;
    // confirm enables 2FA and issues the session atomically).
    fastify.post('/totp/enroll-setup', {
        schema: totpEnrollSetupSchema,
        handler: enrollTotpSetup,
    });
    fastify.post('/totp/enroll-confirm', {
        schema: totpEnrollConfirmSchema,
        handler: enrollTotpConfirm,
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
