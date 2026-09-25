import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/sessionManager.js', () => ({
    generateFingerprint: vi.fn(() => 'fp'),
    validateFingerprint: vi.fn(() => true),
    isSessionExpired: vi.fn(() => false),
    isTokenBlacklisted: vi.fn(() => false),
}));
vi.mock('../services/securityAuditLogger.js', () => ({
    logSecurityEvent: vi.fn(),
    logFingerprintMismatch: vi.fn(),
    logSessionInvalidated: vi.fn(),
    SECURITY_EVENTS: {},
}));

import { fingerprintAuthMiddleware } from '../middleware/fingerprintValidator.js';

function makeReqRes(decoded) {
    const request = {
        headers: { authorization: 'Bearer tok' },
        cookies: {},
        ip: '127.0.0.1',
        server: { jwt: { verify: vi.fn(() => decoded) } },
    };
    const reply = {
        statusCode: 200,
        payload: null,
        code(c) { this.statusCode = c; return this; },
        send(p) { this.payload = p; return this; },
    };
    return { request, reply };
}

describe('fingerprintAuthMiddleware token-type gate', () => {
    it('accepts a session access token', async () => {
        const { request, reply } = makeReqRes({
            id: 1, username: 'u', role: 'admin', type: 'access',
            fingerprint: 'fp', sessionCreatedAt: Date.now(),
        });
        await fingerprintAuthMiddleware(request, reply);
        expect(reply.statusCode).toBe(200);
        expect(request.user?.type).toBe('access');
    });

    it('rejects a REFRESH token even though it carries fingerprint+sessionCreatedAt', async () => {
        // Regression: refresh tokens contain every claim this middleware checked, so before
        // the type gate they passed all checks and authenticated as a session.
        const { request, reply } = makeReqRes({
            id: 1, username: 'u', role: 'admin', type: 'refresh',
            fingerprint: 'fp', sessionCreatedAt: Date.now(),
        });
        await fingerprintAuthMiddleware(request, reply);
        expect(reply.statusCode).toBe(401);
        expect(request.user).toBeUndefined();
    });

    it('rejects totp_pending / other non-access token types', async () => {
        for (const type of ['totp_pending', 'totp_enroll', 'stream_access', undefined]) {
            const { request, reply } = makeReqRes({
                id: 1, type, fingerprint: 'fp', sessionCreatedAt: Date.now(),
            });
            await fingerprintAuthMiddleware(request, reply);
            expect(reply.statusCode).toBe(401);
            expect(request.user).toBeUndefined();
        }
    });

    it('401 when no token at all', async () => {
        const { request, reply } = makeReqRes({});
        request.headers.authorization = undefined;
        await fingerprintAuthMiddleware(request, reply);
        expect(reply.statusCode).toBe(401);
    });
});
