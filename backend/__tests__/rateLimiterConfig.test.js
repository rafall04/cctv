/**
 * Purpose: Verify rateLimiter honors RATE_LIMIT_ENABLED and reads RATE_LIMIT_PUBLIC/AUTH/ADMIN.
 * Caller: Vitest backend suite.
 * Deps: middleware/rateLimiter.js re-imported per test with mutated env.
 * MainFuncs: getRateLimitForType, rateLimiterMiddleware via fastify inject.
 * SideEffects: None beyond per-test env mutation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

// This file is about the ENV layer. rateLimiter now resolves DB → env → default through
// securitySettingsService, so without this mock the assertions read the developer's real cctv.db
// and start failing the moment an admin saves anything in Pengaturan → Keamanan. (It did: a saved
// rateLimitAdmin=300 turned "falls back to defaults" red.) An empty settings table keeps the
// resolution deterministic and env-only.
vi.mock('../database/connectionPool.js', () => ({
    queryOne: () => undefined,
    query: () => [],
    execute: () => ({ changes: 0 }),
}));

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

describe('media GET whitelist — thumbnails & recording streams', () => {
    /*
     * Regression for the July-2026 incident: a visitor on an area page fired dozens of
     * /api/thumbnails/*.jpg fetches, exhausted the shared 100/min 'public' bucket, and
     * every subsequent /api/* call — including the playback page's endpoints — 429'd
     * until the 60s window rolled. Media GETs must not share the JSON bucket.
     */
    it('thumbnail GETs are whitelisted; POSTs to the same path are not', async () => {
        const { isWhitelisted, getEndpointType } = await loadRateLimiter({});
        expect(isWhitelisted('/api/thumbnails/1377.jpg', 'GET')).toBe(true);
        expect(isWhitelisted('/api/thumbnails/1377.jpg?v=2', 'GET')).toBe(true);
        expect(isWhitelisted('/api/thumbnails/1377.jpg', 'POST')).toBe(false);
        expect(getEndpointType('/api/thumbnails/1377.jpg', 'GET')).toBe('whitelist');
        expect(getEndpointType('/api/thumbnails/1377.jpg', 'POST')).toBe('public');
    });

    it('recording stream + playlist GETs are whitelisted; JSON endpoints stay limited', async () => {
        const { isWhitelisted, getEndpointType } = await loadRateLimiter({});
        expect(isWhitelisted('/api/recordings/15/stream/20260808_120000.mp4', 'GET')).toBe(true);
        expect(isWhitelisted('/api/recordings/15/stream/20260808_120000.mp4?scope=admin', 'GET')).toBe(true);
        expect(isWhitelisted('/api/recordings/archive/987/stream?scope=owner', 'GET')).toBe(true);
        expect(isWhitelisted('/api/recordings/15/playlist.m3u8', 'GET')).toBe(true);
        // The segment list and admin controls are JSON API calls, not media — still limited.
        expect(isWhitelisted('/api/recordings/15/segments', 'GET')).toBe(false);
        expect(isWhitelisted('/api/recordings/15/start', 'POST')).toBe(false);
        expect(getEndpointType('/api/recordings/15/segments', 'GET')).toBe('public');
    });

    it('thumbnail fetches no longer consume the shared public bucket', async () => {
        const { rateLimiterMiddleware } = await loadRateLimiter({
            RATE_LIMIT_ENABLED: 'true',
            RATE_LIMIT_PUBLIC: '5',
        });
        const app = Fastify();
        await app.register(rateLimiterMiddleware);
        app.get('/api/thumbnails/:file', async () => ({ ok: true }));
        app.get('/api/x', async () => ({ ok: true }));
        // 20 thumbnail GETs would have burned a 5/min bucket 4x over — all pass.
        for (let i = 0; i < 20; i += 1) {
            const res = await app.inject({ method: 'GET', url: `/api/thumbnails/${i}.jpg` });
            expect(res.statusCode).toBe(200);
        }
        // The JSON bucket itself is untouched: still 5, then 429.
        for (let i = 0; i < 5; i += 1) {
            await app.inject({ method: 'GET', url: '/api/x' });
        }
        expect((await app.inject({ method: 'GET', url: '/api/x' })).statusCode).toBe(429);
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
