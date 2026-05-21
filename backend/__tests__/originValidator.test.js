/**
 * Purpose: Regression test — originValidator must validate against config.security.allowedOrigins
 *          (ALLOWED_ORIGINS env), not the non-existent config.cors.allowedOrigins.
 * Caller: Vitest backend suite.
 * Deps: middleware/originValidator.js, re-imported per test with mutated env.
 * MainFuncs: getAllowedOrigins, isOriginAllowed.
 * SideEffects: Mutates process.env within each test, then restores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadValidator(envOverrides) {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...envOverrides };
    return import('../middleware/originValidator.js');
}

describe('originValidator.getAllowedOrigins', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('returns the production origins from ALLOWED_ORIGINS', async () => {
        const { getAllowedOrigins } = await loadValidator({
            ALLOWED_ORIGINS: 'https://cctv.example.com,https://api-cctv.example.com',
        });
        expect(getAllowedOrigins()).toEqual([
            'https://cctv.example.com',
            'https://api-cctv.example.com',
        ]);
    });

    it('allows a production origin once ALLOWED_ORIGINS is set (the deploy-incident regression)', async () => {
        const { isOriginAllowed } = await loadValidator({
            ALLOWED_ORIGINS: 'https://cctv.example.com',
        });
        expect(isOriginAllowed('https://cctv.example.com')).toBe(true);
        expect(isOriginAllowed('https://evil.example.com')).toBe(false);
    });

    it('falls back to localhost defaults only when no origins are configured', async () => {
        const { getAllowedOrigins } = await loadValidator({
            ALLOWED_ORIGINS: '',
            FRONTEND_DOMAIN: '',
            SERVER_IP: '',
        });
        expect(getAllowedOrigins()).toContain('http://localhost:5173');
    });

    it('allows same-host requests regardless of whitelist (single-port architecture)', async () => {
        const { isOriginAllowed } = await loadValidator({ ALLOWED_ORIGINS: 'https://other.example.com' });
        const sameHostReq = { headers: { host: 'cctv.example.com' } };
        expect(isOriginAllowed('https://cctv.example.com', sameHostReq)).toBe(true);
    });
});
