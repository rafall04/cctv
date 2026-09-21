import { describe, it, expect } from 'vitest';
import {
    SECURITY_HEADERS_CONFIG,
    getSecurityHeaders,
    isAuthEndpoint,
    validateSecurityHeaders,
    validateSecurityHeaderValues,
} from '../middleware/securityHeaders.js';

describe('securityHeaders config', () => {
    it('emits the full hardened header set', () => {
        const h = getSecurityHeaders('/api/cameras');
        expect(h['X-Content-Type-Options']).toBe('nosniff');
        expect(h['X-Frame-Options']).toBe('DENY');
        expect(h['X-XSS-Protection']).toBe('0'); // deprecated auditor explicitly off
        expect(h['Referrer-Policy']).toBe('no-referrer');
        expect(h['Permissions-Policy']).toContain('camera=()');
        expect(h['Strict-Transport-Security']).toContain('max-age=');
    });

    it('API CSP is strict-none — this layer emits JSON/media, never documents', () => {
        const csp = SECURITY_HEADERS_CONFIG.contentSecurityPolicy;
        expect(csp).toContain("default-src 'none'");
        expect(csp).toContain("frame-ancestors 'none'");
        expect(csp).not.toContain('unsafe-inline');
        expect(csp).not.toContain('unsafe-eval');
        expect(csp).not.toContain('http:'); // no wildcard scheme sources
    });

    it('no-store only on auth/admin endpoints', () => {
        expect(getSecurityHeaders('/api/auth/login')['Cache-Control']).toBe('no-store');
        expect(getSecurityHeaders('/api/admin/users')['Cache-Control']).toBe('no-store');
        expect(getSecurityHeaders('/api/cameras/active')['Cache-Control']).toBeUndefined();
        expect(isAuthEndpoint('/api/recordings')).toBe(false);
    });

    it('self-validation passes on the emitted set', () => {
        const h = getSecurityHeaders('/health');
        expect(validateSecurityHeaders(h).valid).toBe(true);
        expect(validateSecurityHeaderValues(h).valid).toBe(true);
    });

    it('validator catches regressions', () => {
        const bad = { ...getSecurityHeaders('/x'), 'X-XSS-Protection': '1; mode=block' };
        expect(validateSecurityHeaderValues(bad).valid).toBe(false);
        const missing = validateSecurityHeaders({});
        expect(missing.valid).toBe(false);
        expect(missing.missing).toContain('Strict-Transport-Security');
    });
});
