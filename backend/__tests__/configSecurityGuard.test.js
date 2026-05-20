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

    it('warns when JWT_SECRET is set but short', async () => {
        const assertSecureConfig = await loadGuard({
            NODE_ENV: 'production',
            JWT_SECRET: 'short-secret',
        });
        const result = assertSecureConfig();
        expect(result.ok).toBe(true);
        expect(result.warnings.some((w) => w.includes('shorter than'))).toBe(true);
    });
});
