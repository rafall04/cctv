/*
 * Purpose: Cover the auth FRONT DOOR (HTTP layer) — cookie policy, status codes, and what the
 *          response body is allowed to contain. authService.test.js already covers the domain
 *          logic (lockout, rotation, blacklist, fingerprint); this file covers the handlers that
 *          sit in front of it, which had no tests at all.
 * Caller:  Backend Vitest suite.
 * Deps:    authController, real getAuthCookieOptions, mocked authService.
 * MainFuncs: login / logout / refreshTokens / verifyToken handler tests.
 * SideEffects: None.
 *
 * Two properties here are security properties, not cosmetics:
 *   - an unexpected failure must answer a GENERIC 500, never echo the internal error;
 *   - logout must clear the refresh cookie on the SAME path it was set on, otherwise the
 *     refresh token stays alive in the browser after "logout".
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../services/authService.js', () => ({
    default: { login: vi.fn(), logout: vi.fn(), refreshTokens: vi.fn() },
}));
vi.mock('../services/billingPlanService.js', () => ({
    default: { registerCustomer: vi.fn(), getRegistrationSettings: vi.fn() },
}));
vi.mock('../services/telegramBotService.js', () => ({
    default: { notifyNewRegistration: vi.fn(() => Promise.resolve()) },
}));

const authService = (await import('../services/authService.js')).default;
const { login, logout, refreshTokens, verifyToken } = await import('../controllers/authController.js');

function makeReply() {
    const reply = {
        statusCode: 200,
        body: null,
        cookies: [],
        cleared: [],
        code(status) { this.statusCode = status; return this; },
        send(payload) { this.body = payload; return this; },
        setCookie(name, value, options) { this.cookies.push({ name, value, options }); return this; },
        clearCookie(name, options) { this.cleared.push({ name, options }); return this; },
    };
    return reply;
}

const makeRequest = (overrides = {}) => ({
    body: {},
    cookies: {},
    headers: {},
    ip: '203.0.113.9',
    server: {},
    ...overrides,
});

const cookie = (reply, name) => reply.cookies.find((c) => c.name === name);

beforeEach(() => {
    vi.clearAllMocks();
});

describe('login handler', () => {
    const validLogin = {
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        user: { id: 3, username: 'admin', role: 'admin' },
    };

    it('rejects missing credentials with 400 without ever reaching the service', async () => {
        const reply = makeReply();
        await login(makeRequest({ body: { username: 'admin' } }), reply);

        expect(reply.statusCode).toBe(400);
        expect(reply.body.success).toBe(false);
        expect(authService.login).not.toHaveBeenCalled();
        expect(reply.cookies).toHaveLength(0);
    });

    it('sets HttpOnly auth cookies, and scopes the refresh cookie to the refresh route', async () => {
        authService.login.mockResolvedValue(validLogin);
        const reply = makeReply();
        await login(makeRequest({ body: { username: 'admin', password: 'pw' } }), reply);

        expect(reply.statusCode).toBe(200);
        expect(reply.body.success).toBe(true);

        const access = cookie(reply, 'token');
        const refresh = cookie(reply, 'refreshToken');
        expect(access.value).toBe('access-token-value');
        expect(access.options).toMatchObject({ httpOnly: true, path: '/' });
        expect(refresh.value).toBe('refresh-token-value');
        // Scoped so the long-lived refresh token is not attached to every API call.
        expect(refresh.options).toMatchObject({ httpOnly: true, path: '/api/auth/refresh' });
    });

    it('marks cookies Secure + SameSite=None only when the request arrived over https', async () => {
        authService.login.mockResolvedValue(validLogin);

        const plain = makeReply();
        await login(makeRequest({ body: { username: 'a', password: 'b' } }), plain);
        expect(cookie(plain, 'token').options).toMatchObject({ secure: false, sameSite: 'lax' });

        const secure = makeReply();
        await login(
            makeRequest({ body: { username: 'a', password: 'b' }, headers: { 'x-forwarded-proto': 'https' } }),
            secure
        );
        expect(cookie(secure, 'token').options).toMatchObject({ secure: true, sameSite: 'none' });
    });

    it('passes a 401 through as 401 and sets no cookies', async () => {
        const err = new Error('Invalid credentials');
        err.statusCode = 401;
        authService.login.mockRejectedValue(err);

        const reply = makeReply();
        await login(makeRequest({ body: { username: 'admin', password: 'salah' } }), reply);

        expect(reply.statusCode).toBe(401);
        expect(reply.body).toEqual({ success: false, message: 'Invalid credentials' });
        expect(reply.cookies).toHaveLength(0);
    });

    it('surfaces the approval reason on a 403 so the UI can explain it', async () => {
        const err = new Error('Akun menunggu persetujuan');
        err.statusCode = 403;
        err.reason = 'pending_approval';
        authService.login.mockRejectedValue(err);

        const reply = makeReply();
        await login(makeRequest({ body: { username: 'baru', password: 'pw' } }), reply);

        expect(reply.statusCode).toBe(403);
        expect(reply.body.reason).toBe('pending_approval');
        expect(reply.body.message).toBe('Akun menunggu persetujuan');
    });

    it('answers a GENERIC 500 on an unexpected failure — internals must not reach the client', async () => {
        authService.login.mockRejectedValue(new Error('SQLITE_ERROR: no such column: secret_hash'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const reply = makeReply();
        await login(makeRequest({ body: { username: 'admin', password: 'pw' } }), reply);

        expect(reply.statusCode).toBe(500);
        expect(reply.body).toEqual({ success: false, message: 'Internal server error' });
        expect(JSON.stringify(reply.body)).not.toMatch(/SQLITE|secret_hash/);
    });

    it('forwards the password-expiry hints the service reports', async () => {
        authService.login.mockResolvedValue({ ...validLogin, passwordExpiryStatus: { expired: true } });
        const reply = makeReply();
        await login(makeRequest({ body: { username: 'admin', password: 'pw' } }), reply);

        expect(reply.body.data.passwordExpired).toBe(true);
    });
});

describe('refreshTokens handler', () => {
    it('refuses with 401 when no refresh token is presented, without calling the service', async () => {
        const reply = makeReply();
        await refreshTokens(makeRequest(), reply);

        expect(reply.statusCode).toBe(401);
        expect(authService.refreshTokens).not.toHaveBeenCalled();
    });

    it('reads the refresh token from the cookie and writes the rotated pair back', async () => {
        authService.refreshTokens.mockResolvedValue({
            newAccessToken: 'new-access',
            newRefreshToken: 'new-refresh',
        });

        const reply = makeReply();
        await refreshTokens(makeRequest({ cookies: { refreshToken: 'old-refresh' } }), reply);

        expect(authService.refreshTokens).toHaveBeenCalledWith('old-refresh', expect.anything(), expect.anything());
        expect(cookie(reply, 'token').value).toBe('new-access');
        expect(cookie(reply, 'refreshToken').value).toBe('new-refresh');
        expect(cookie(reply, 'refreshToken').options).toMatchObject({ path: '/api/auth/refresh' });
    });

    it('falls back to the body when no cookie is present', async () => {
        authService.refreshTokens.mockResolvedValue({ newAccessToken: 'a', newRefreshToken: 'b' });

        await refreshTokens(makeRequest({ body: { refreshToken: 'from-body' } }), makeReply());

        expect(authService.refreshTokens).toHaveBeenCalledWith('from-body', expect.anything(), expect.anything());
    });

    it('passes a rejected refresh through as 401 and issues no cookies', async () => {
        const err = new Error('Invalid refresh token');
        err.statusCode = 401;
        authService.refreshTokens.mockRejectedValue(err);

        const reply = makeReply();
        await refreshTokens(makeRequest({ cookies: { refreshToken: 'basi' } }), reply);

        expect(reply.statusCode).toBe(401);
        expect(reply.cookies).toHaveLength(0);
    });

    it('answers a GENERIC 500 on an unexpected failure', async () => {
        authService.refreshTokens.mockRejectedValue(new Error('redis down at 10.0.0.4:6379'));
        vi.spyOn(console, 'error').mockImplementation(() => {});

        const reply = makeReply();
        await refreshTokens(makeRequest({ cookies: { refreshToken: 'x' } }), reply);

        expect(reply.statusCode).toBe(500);
        expect(reply.body).toEqual({ success: false, message: 'Internal server error' });
        expect(JSON.stringify(reply.body)).not.toMatch(/redis|10\.0\.0\.4/);
    });
});

describe('logout handler', () => {
    it('clears the refresh cookie on the SAME path it was set on', async () => {
        authService.logout.mockResolvedValue(undefined);

        const reply = makeReply();
        await logout(
            makeRequest({ user: { id: 3 }, token: 'access', cookies: { refreshToken: 'refresh' } }),
            reply
        );

        expect(reply.body.success).toBe(true);
        const clearedRefresh = reply.cleared.find((c) => c.name === 'refreshToken');
        const clearedAccess = reply.cleared.find((c) => c.name === 'token');
        expect(clearedAccess.options).toMatchObject({ path: '/' });
        // A mismatch here silently leaves the refresh token usable after "logout".
        expect(clearedRefresh.options).toMatchObject({ path: '/api/auth/refresh' });
    });

    it('hands both tokens to the service so they can be blacklisted', async () => {
        authService.logout.mockResolvedValue(undefined);

        await logout(
            makeRequest({ user: { id: 7 }, token: 'access-tok', cookies: { refreshToken: 'refresh-tok' } }),
            makeReply()
        );

        expect(authService.logout).toHaveBeenCalledWith(7, expect.any(String), 'access-tok', 'refresh-tok');
    });
});

describe('verifyToken handler', () => {
    it('returns only id, username and role — never the rest of the user record', async () => {
        const reply = makeReply();
        await verifyToken(
            makeRequest({
                user: {
                    id: 3,
                    username: 'admin',
                    role: 'admin',
                    password: '$2b$10$hashedsecret',
                    email: 'admin@example.com',
                },
            }),
            reply
        );

        expect(reply.body.data.user).toEqual({ id: 3, username: 'admin', role: 'admin' });
        expect(JSON.stringify(reply.body)).not.toMatch(/hashedsecret|admin@example\.com/);
    });
});
