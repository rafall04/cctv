/**
 * Purpose: Validate assertSecureConfig fail-fast guard against insecure production secrets.
 * Caller: Vitest backend suite.
 * Deps: config/config.js (re-imported per test with mutated env).
 * MainFuncs: assertSecureConfig.
 * SideEffects: None; mutates process.env within each test then restores.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadGuard(envOverrides) {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...envOverrides };
    const mod = await import('../config/config.js');
    return mod.assertSecureConfig;
}

describe('assertSecureConfig', () => {
    beforeEach(() => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.restoreAllMocks();
    });

    it('throws in production when JWT_SECRET is the built-in default', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'default-secret-change-in-production',
        });
        expect(() => assertSecureConfig()).toThrow(/Refusing to start in production/);
    });

    it('throws in production when JWT_SECRET is missing', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: '',
        });
        expect(() => assertSecureConfig()).toThrow(/JWT_SECRET is missing/);
    });

    it('passes in production with a strong unique JWT_SECRET', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            // Hermetic: the assertion is about the secret, but a production boot also requires a
            // resolvable CORS origin — a fresh checkout has no .env to provide one ambiently.
            ALLOWED_ORIGINS: 'https://cctv.example.test',
        });
        const result = assertSecureConfig();
        expect(result.ok).toBe(true);
        expect(result.errors).toHaveLength(0);
    });

    it('warns but does not throw in development with the default secret', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'development',
            JWT_SECRET: 'default-secret-change-in-production',
        });
        let result;
        expect(() => { result = assertSecureConfig(); }).not.toThrow();
        expect(result.ok).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it('throws in production when JWT_SECRET is too short', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'short-secret',
        });
        expect(() => assertSecureConfig()).toThrow(/shorter than/);
    });

    it('only warns about a short JWT_SECRET in development', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'development',
            JWT_SECRET: 'short-secret',
        });
        const result = assertSecureConfig();
        expect(result.ok).toBe(true);
        expect(result.warnings.some((w) => w.includes('shorter than'))).toBe(true);
    });

    it('throws in production when JWT_SECRET is a committed placeholder value', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'CHANGE_THIS_TO_96_CHAR_HEX_SECRET',
        });
        expect(() => assertSecureConfig()).toThrow(/placeholder/);
    });

    it('throws in production for the weak secret shipped in backend.env.prod', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'raf_net_secure_cctv_2025_prod',
        });
        expect(() => assertSecureConfig()).toThrow(/placeholder/);
    });

    it('throws in production when a numeric env var is set but unparsable', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            PORT: 'tiga-ribu',
        });
        expect(() => assertSecureConfig()).toThrow(/PORT.*not a number/);
    });

    it('throws in production when no CORS origin can be resolved', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            ALLOWED_ORIGINS: '',
            FRONTEND_DOMAIN: '',
            SERVER_IP: '',
        });
        expect(() => assertSecureConfig()).toThrow(/No CORS origins/);
    });

    it('throws in production when PUBLIC_STREAM_BASE_URL has no scheme', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            PUBLIC_STREAM_BASE_URL: 'cctv.raf.my.id',
        });
        expect(() => assertSecureConfig()).toThrow(/PUBLIC_STREAM_BASE_URL/);
    });

    it('warns instead of throwing for malformed PUBLIC_STREAM_BASE_URL outside production', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'development',
            JWT_SECRET: 'a'.repeat(48),
            PUBLIC_STREAM_BASE_URL: 'cctv.raf.my.id',
        });
        const result = assertSecureConfig();
        expect(result.warnings.some((w) => w.includes('PUBLIC_STREAM_BASE_URL'))).toBe(true);
    });

    it('throws in production when CSRF_SECRET / API_KEY_SECRET are placeholders', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'a'.repeat(48),
            CSRF_ENABLED: 'true',
            CSRF_SECRET: 'CHANGE_THIS_TO_32_CHAR_HEX_SECRET',
            API_KEY_VALIDATION_ENABLED: 'true',
            API_KEY_SECRET: 'CHANGE_THIS_TO_64_CHAR_HEX_SECRET',
        });
        expect(() => assertSecureConfig()).toThrow(/placeholder/);
    });
});
