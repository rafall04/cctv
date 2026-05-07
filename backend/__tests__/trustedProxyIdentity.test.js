/**
 * Purpose: Verify client IP resolution only trusts proxy headers from configured trusted proxy CIDRs.
 * Caller: Backend Vitest suite for utils/trustedProxyIdentity.js.
 * Deps: Vitest, trustedProxyIdentity utilities.
 * MainFuncs: getTrustedViewerIdentity, isTrustedProxy.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { getTrustedViewerIdentity, isTrustedProxy } from '../utils/trustedProxyIdentity.js';

describe('trustedProxyIdentity', () => {
    it('ignores forwarded headers from untrusted remote addresses', () => {
        const identity = getTrustedViewerIdentity({
            ip: '203.0.113.10',
            headers: {
                'x-forwarded-for': '8.8.8.8',
                'x-real-ip': '1.1.1.1',
            },
        }, ['127.0.0.1/32']);

        expect(identity).toBe('203.0.113.10');
    });

    it('accepts forwarded headers from trusted proxies', () => {
        const identity = getTrustedViewerIdentity({
            ip: '127.0.0.1',
            headers: {
                'x-forwarded-for': '8.8.8.8, 10.0.0.1',
            },
        }, ['127.0.0.1/32']);

        expect(identity).toBe('8.8.8.8');
    });

    it('matches IPv4 CIDR trusted proxy ranges', () => {
        expect(isTrustedProxy('10.10.5.12', ['10.10.0.0/16'])).toBe(true);
        expect(isTrustedProxy('10.11.5.12', ['10.10.0.0/16'])).toBe(false);
    });
});
