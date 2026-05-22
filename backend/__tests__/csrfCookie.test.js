/**
 * Purpose: Verify the CSRF cookie's Secure flag follows the request protocol,
 *          so a plain-HTTP (LAN/IP) deployment is not silently broken.
 * Caller: Vitest backend suite.
 * Deps: middleware/csrfProtection.js setCsrfCookie.
 * MainFuncs: setCsrfCookie.
 * SideEffects: None.
 */
import { describe, expect, it, vi } from 'vitest';
import { setCsrfCookie } from '../middleware/csrfProtection.js';

function makeReply() {
    return { setCookie: vi.fn() };
}

describe('setCsrfCookie — Secure flag', () => {
    it('sets a non-Secure cookie over plain HTTP so the browser keeps it', () => {
        const reply = makeReply();
        setCsrfCookie(reply, 'token-abc', { headers: {}, protocol: 'http' });

        const [, , options] = reply.setCookie.mock.calls[0];
        expect(options.secure).toBe(false);
        expect(options.httpOnly).toBe(true);
    });

    it('sets a Secure cookie when the request is HTTPS (x-forwarded-proto)', () => {
        const reply = makeReply();
        setCsrfCookie(reply, 'token-abc', { headers: { 'x-forwarded-proto': 'https' } });

        const [, , options] = reply.setCookie.mock.calls[0];
        expect(options.secure).toBe(true);
    });

    it('sets a Secure cookie when the socket is TLS-encrypted', () => {
        const reply = makeReply();
        setCsrfCookie(reply, 'token-abc', { headers: {}, socket: { encrypted: true } });

        const [, , options] = reply.setCookie.mock.calls[0];
        expect(options.secure).toBe(true);
    });
});
