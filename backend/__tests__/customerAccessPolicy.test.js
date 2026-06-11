/**
 * Purpose: Verify the customer deny-by-default lockout hook and the gated-HLS helper
 *          functions (viewer resolution from JWT, playlist token propagation).
 * Caller: Backend focused test gate for tenancy middleware/helpers.
 * Deps: vitest, jsonwebtoken, mocked audit logger.
 * MainFuncs: customerAccessPolicyHook tests, propagateTokenInPlaylist tests,
 *            resolveHlsViewerUser tests.
 * SideEffects: None.
 */

import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('../services/securityAuditLogger.js', () => ({
    logAuthorizationFailure: vi.fn(),
}));

import { customerAccessPolicyHook, isCustomerAllowedPath } from '../middleware/customerAccessPolicy.js';
import { propagateTokenInPlaylist, resolveHlsViewerUser } from '../services/hlsProxyService.js';
import { config } from '../config/config.js';

function makeReply() {
    const reply = {
        statusCode: null,
        body: null,
        code(value) { this.statusCode = value; return this; },
        send(payload) { this.body = payload; return this; },
    };
    return reply;
}

describe('customerAccessPolicyHook', () => {
    it('ignores requests where auth was not required (public/optional-auth routes)', async () => {
        const reply = makeReply();
        await customerAccessPolicyHook({ user: { role: 'customer' }, url: '/api/cameras' }, reply);
        expect(reply.statusCode).toBe(null);
    });

    it('ignores staff users on protected routes', async () => {
        const reply = makeReply();
        await customerAccessPolicyHook(
            { authWasRequired: true, user: { role: 'viewer' }, url: '/api/cameras' },
            reply
        );
        expect(reply.statusCode).toBe(null);
    });

    it('blocks customers on protected staff routes with 403', async () => {
        const reply = makeReply();
        await customerAccessPolicyHook(
            { authWasRequired: true, user: { role: 'customer', username: 'budi' }, url: '/api/cameras' },
            reply
        );
        expect(reply.statusCode).toBe(403);
    });

    it('allows customers on whitelisted prefixes', async () => {
        for (const url of ['/api/auth/logout', '/api/users/profile', '/api/users/profile/password', '/api/customer/wallet?limit=10']) {
            const reply = makeReply();
            await customerAccessPolicyHook(
                { authWasRequired: true, user: { role: 'customer' }, url },
                reply
            );
            expect(reply.statusCode, url).toBe(null);
        }
    });

    it('does not let query strings spoof the whitelist', () => {
        expect(isCustomerAllowedPath('/api/cameras?x=/api/customer/')).toBe(false);
    });
});

describe('propagateTokenInPlaylist', () => {
    const token = 'tok.en-value';

    it('appends the token to segment lines, child playlists, and EXT-X-MAP URIs', () => {
        const playlist = [
            '#EXTM3U',
            '#EXT-X-VERSION:9',
            '#EXT-X-MAP:URI="init.mp4"',
            '#EXTINF:2.000,',
            'segment_001.mp4',
            'child_stream.m3u8',
            '',
        ].join('\n');

        const rewritten = propagateTokenInPlaylist(playlist, token);
        const encoded = encodeURIComponent(token);

        expect(rewritten).toContain(`#EXT-X-MAP:URI="init.mp4?token=${encoded}"`);
        expect(rewritten).toContain(`segment_001.mp4?token=${encoded}`);
        expect(rewritten).toContain(`child_stream.m3u8?token=${encoded}`);
        // Non-URI directives stay untouched.
        expect(rewritten).toContain('#EXT-X-VERSION:9');
    });

    it('uses & when the URI already has a query string', () => {
        const rewritten = propagateTokenInPlaylist('seg.mp4?sig=abc', token);
        expect(rewritten).toBe(`seg.mp4?sig=abc&token=${encodeURIComponent(token)}`);
    });

    it('never leaks the token onto absolute external URLs', () => {
        const rewritten = propagateTokenInPlaylist('https://upstream.example/seg.ts', token);
        expect(rewritten).toBe('https://upstream.example/seg.ts');
    });

    it('is a no-op without a token', () => {
        expect(propagateTokenInPlaylist('seg.mp4', null)).toBe('seg.mp4');
    });
});

describe('resolveHlsViewerUser', () => {
    it('decodes a valid user JWT from the cookie', () => {
        const token = jwt.sign({ id: 9, role: 'customer', type: 'access' }, config.jwt.secret);
        const user = resolveHlsViewerUser({ cookies: { token }, headers: {} });
        expect(user.id).toBe(9);
        expect(user.role).toBe('customer');
    });

    it('decodes a Bearer token from the Authorization header', () => {
        const token = jwt.sign({ id: 3, role: 'admin', type: 'access' }, config.jwt.secret);
        const user = resolveHlsViewerUser({ cookies: {}, headers: { authorization: `Bearer ${token}` } });
        expect(user.id).toBe(3);
    });

    it('ignores stream_access tokens (those are handled separately)', () => {
        const token = jwt.sign({ cameraId: 7, type: 'stream_access' }, config.jwt.secret);
        expect(resolveHlsViewerUser({ cookies: { token }, headers: {} })).toBe(null);
    });

    it('returns null for garbage or missing tokens instead of throwing', () => {
        expect(resolveHlsViewerUser({ cookies: { token: 'garbage' }, headers: {} })).toBe(null);
        expect(resolveHlsViewerUser({ cookies: {}, headers: {} })).toBe(null);
    });
});
