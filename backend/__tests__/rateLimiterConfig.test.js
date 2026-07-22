/**
 * Purpose: Verify rateLimiter honors RATE_LIMIT_ENABLED and reads RATE_LIMIT_PUBLIC/AUTH/ADMIN.
 * Caller: Vitest backend suite.
 * Deps: middleware/rateLimiter.js re-imported per test with mutated env.
 * MainFuncs: getRateLimitForType, rateLimiterMiddleware via fastify inject.
 * SideEffects: None beyond per-test env mutation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const ORIGINAL_ENV = { ...process.env };

async function loadRateLimiter(envOverrides) {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...envOverrides };
    return import('../middleware/rateLimiter.js');
}

describe('rateLimiter — config wiring', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('reads RATE_LIMIT_PUBLIC/AUTH/ADMIN from env', async () => {
        const { getRateLimitForType } = await loadRateLimiter({
            RATE_LIMIT_PUBLIC: '500',
            RATE_LIMIT_AUTH: '40',
            RATE_LIMIT_ADMIN: '200',
        });
        expect(getRateLimitForType('public').max).toBe(500);
        expect(getRateLimitForType('auth').max).toBe(40);
        expect(getRateLimitForType('admin').max).toBe(200);
    });

    it('falls back to defaults when env values are absent', async () => {
        const { getRateLimitForType } = await loadRateLimiter({
            RATE_LIMIT_PUBLIC: '',
            RATE_LIMIT_AUTH: '',
            RATE_LIMIT_ADMIN: '',
        });
        expect(getRateLimitForType('public').max).toBe(100);
        expect(getRateLimitForType('auth').max).toBe(30);
        expect(getRateLimitForType('admin').max).toBe(60);
    });

    it('RATE_LIMIT_ENABLED=false fully disables the limiter (no 429, no headers)', async () => {
        const { rateLimiterMiddleware } = await loadRateLimiter({ RATE_LIMIT_ENABLED: 'false' });
        const app = Fastify();
        await app.register(rateLimiterMiddleware);
        app.get('/api/x', async () => ({ ok: true }));
        // Far more requests than the default limit of 100.
        let last;
        for (let i = 0; i < 150; i += 1) {
            last = await app.inject({ method: 'GET', url: '/api/x' });
        }
        expect(last.statusCode).toBe(200);
        expect(last.headers['x-ratelimit-limit']).toBeUndefined();
        await app.close();
    });

    it('RATE_LIMIT_ENABLED=true enforces the limit and 429s past it', async () => {
        const { rateLimiterMiddleware } = await loadRateLimiter({
            RATE_LIMIT_ENABLED: 'true',
            RATE_LIMIT_PUBLIC: '5',
        });
        const app = Fastify();
        await app.register(rateLimiterMiddleware);
        app.get('/api/x', async () => ({ ok: true }));
        const codes = [];
        for (let i = 0; i < 8; i += 1) {
            codes.push((await app.inject({ method: 'GET', url: '/api/x' })).statusCode);
        }
        expect(codes.filter((c) => c === 200).length).toBe(5);
        expect(codes.filter((c) => c === 429).length).toBe(3);
        await app.close();
    });
});

describe('resolveClientIp — per-user bucketing behind proxies', () => {
    it('prefers CF-Connecting-IP (the real visitor) over the proxy socket ip', async () => {
        const { resolveClientIp } = await loadRateLimiter({});
        // request.ip is the proxy hop; CF-Connecting-IP is the genuine client.
        expect(resolveClientIp({ ip: '172.17.11.2', headers: { 'cf-connecting-ip': '203.0.113.9' } }))
            .toBe('203.0.113.9');
    });

    it('two different CF-Connecting-IPs get independent buckets (not one global bucket)', async () => {
        const { resolveClientIp, generateRateLimitKey } = await loadRateLimiter({});
        const a = generateRateLimitKey(resolveClientIp({ ip: '172.17.11.2', headers: { 'cf-connecting-ip': '1.1.1.1' } }), 'public');
        const b = generateRateLimitKey(resolveClientIp({ ip: '172.17.11.2', headers: { 'cf-connecting-ip': '2.2.2.2' } }), 'public');
        expect(a).not.toBe(b);
    });

    it('falls back to request.ip, then XFF, then unknown', async () => {
        const { resolveClientIp } = await loadRateLimiter({});
        expect(resolveClientIp({ ip: '10.0.0.5', headers: {} })).toBe('10.0.0.5');
        expect(resolveClientIp({ headers: { 'x-forwarded-for': '198.51.100.7, 10.0.0.1' } })).toBe('198.51.100.7');
        expect(resolveClientIp({ headers: {} })).toBe('unknown');
        // Blank CF header is ignored (does not become the key).
        expect(resolveClientIp({ ip: '10.0.0.9', headers: { 'cf-connecting-ip': '  ' } })).toBe('10.0.0.9');
    });
});
