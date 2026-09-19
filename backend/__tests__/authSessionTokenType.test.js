/**
 * Purpose: Freeze the token-type invariant in authMiddleware — a publicly minted
 *          `stream_access` JWT (GET /api/stream/:id/token) and a `refresh` JWT are
 *          signed with the same secret as a session token but are NOT identities.
 *          Before this guard, a stream token sent as `Authorization: Bearer` or
 *          `Cookie: token=` passed `jwtVerify()` and unlocked every
 *          authenticate-only route (RTSP credentials via
 *          /api/admin/debug/camera-health, viewer IP history, feedback PII).
 * Caller: Vitest backend suite.
 * Deps: middleware/authMiddleware.js authMiddleware + optionalAuthMiddleware.
 * MainFuncs: authMiddleware, optionalAuthMiddleware.
 * SideEffects: None.
 */
import { describe, expect, it, vi } from 'vitest';
import { authMiddleware, optionalAuthMiddleware } from '../middleware/authMiddleware.js';

function makeReply() {
    const reply = {
        statusCode: null,
        payload: null,
        code(status) {
            this.statusCode = status;
            return this;
        },
        send(payload) {
            this.payload = payload;
            return this;
        },
    };
    return reply;
}

function makeRequest({ headerUser, cookieUser } = {}) {
    return {
        authWasRequired: false,
        user: null,
        cookies: cookieUser ? { token: 'cookie.jwt' } : {},
        jwtVerify: vi.fn(async function () {
            if (!headerUser) {
                throw new Error('no bearer token');
            }
            this.user = headerUser;
        }),
        server: {
            jwt: {
                verify: vi.fn(() => {
                    if (!cookieUser) {
                        throw new Error('bad cookie token');
                    }
                    return cookieUser;
                }),
            },
        },
    };
}

const STREAM_TOKEN = { cameraId: 1, streamKey: 'abc', type: 'stream_access' };
const REFRESH_TOKEN = { id: 1, username: 'x', type: 'refresh' };
const SESSION_TOKEN = { id: 1, username: 'x', role: 'viewer', type: 'access' };

describe('authMiddleware rejects non-session tokens', () => {
    it('rejects a public stream_access token sent as Authorization: Bearer', async () => {
        const reply = makeReply();
        await authMiddleware(makeRequest({ headerUser: STREAM_TOKEN }), reply);
        expect(reply.statusCode).toBe(401);
    });

    it('rejects a public stream_access token sent as Cookie: token=', async () => {
        const reply = makeReply();
        await authMiddleware(makeRequest({ cookieUser: STREAM_TOKEN }), reply);
        expect(reply.statusCode).toBe(401);
    });

    it('rejects a refresh token', async () => {
        const reply = makeReply();
        await authMiddleware(makeRequest({ headerUser: REFRESH_TOKEN }), reply);
        expect(reply.statusCode).toBe(401);
    });

    it('accepts a real session access token from header and cookie', async () => {
        const headerReply = makeReply();
        const headerReq = makeRequest({ headerUser: SESSION_TOKEN });
        await authMiddleware(headerReq, headerReply);
        expect(headerReply.statusCode).toBeNull();
        expect(headerReq.user).toBe(SESSION_TOKEN);

        const cookieReply = makeReply();
        const cookieReq = makeRequest({ cookieUser: SESSION_TOKEN });
        await authMiddleware(cookieReq, cookieReply);
        expect(cookieReply.statusCode).toBeNull();
        expect(cookieReq.user).toBe(SESSION_TOKEN);
    });
});

describe('optionalAuthMiddleware treats non-session tokens as anonymous', () => {
    it('does not set request.user for a stream_access token', async () => {
        const req = makeRequest({ headerUser: STREAM_TOKEN });
        await optionalAuthMiddleware(req, makeReply());
        expect(req.user).toBeNull();
    });

    it('does not set request.user for a stream_access cookie', async () => {
        const req = makeRequest({ cookieUser: STREAM_TOKEN });
        await optionalAuthMiddleware(req, makeReply());
        expect(req.user).toBeNull();
    });

    it('sets request.user for a session token', async () => {
        const req = makeRequest({ headerUser: SESSION_TOKEN });
        await optionalAuthMiddleware(req, makeReply());
        expect(req.user).toBe(SESSION_TOKEN);
    });
});
