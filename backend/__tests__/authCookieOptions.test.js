/*
 * Purpose: Verify auth cookie options for domain and direct-IP admin access.
 * Caller: Backend Vitest suite before auth cookie changes.
 * Deps: authCookieOptions helper.
 * MainFuncs: getAuthCookieOptions.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { getAuthCookieOptions } from '../utils/authCookieOptions.js';

const makeRequest = ({ host, forwardedProto, protocol = 'http', encrypted = false }) => ({
    headers: {
        host,
        ...(forwardedProto ? { 'x-forwarded-proto': forwardedProto } : {}),
    },
    protocol,
    socket: {
        encrypted,
    },
});

describe('getAuthCookieOptions', () => {
    it('uses lax non-secure cookies for direct HTTP IP same-origin access', () => {
        const options = getAuthCookieOptions(makeRequest({ host: '172.17.11.12:800' }));

        expect(options.access).toMatchObject({
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 60 * 60,
        });
    });

    it('uses secure none cookies when proxy reports HTTPS', () => {
        const options = getAuthCookieOptions(makeRequest({
            host: '172.17.11.12',
            forwardedProto: 'https',
        }));

        expect(options.access.secure).toBe(true);
        expect(options.access.sameSite).toBe('none');
        expect(options.refresh.secure).toBe(true);
        expect(options.refresh.sameSite).toBe('none');
    });

    it('uses secure none cookies when Fastify reports HTTPS protocol', () => {
        const options = getAuthCookieOptions(makeRequest({
            host: 'cctv.example.test',
            protocol: 'https',
        }));

        expect(options.access.secure).toBe(true);
        expect(options.access.sameSite).toBe('none');
    });

    it('uses secure none cookies when the socket is encrypted', () => {
        const options = getAuthCookieOptions(makeRequest({
            host: 'cctv.example.test',
            encrypted: true,
        }));

        expect(options.access.secure).toBe(true);
        expect(options.access.sameSite).toBe('none');
    });

    it('keeps refresh token scoped to refresh route', () => {
        const options = getAuthCookieOptions(makeRequest({ host: 'cctv.example.test' }));

        expect(options.refresh).toMatchObject({
            path: '/api/auth/refresh',
            httpOnly: true,
            maxAge: 7 * 24 * 60 * 60,
        });
    });
});
