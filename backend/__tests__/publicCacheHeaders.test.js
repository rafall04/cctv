import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { publicCacheHeadersMiddleware, resolvePublicMaxAge } from '../middleware/publicCacheHeaders.js';

describe('resolvePublicMaxAge', () => {
    it('returns TTLs for whitelisted public GETs', () => {
        expect(resolvePublicMaxAge('/api/cameras/active')).toBe(15);
        expect(resolvePublicMaxAge('/api/config/public')).toBe(60);
        expect(resolvePublicMaxAge('/api/settings/timezone')).toBe(300);
        expect(resolvePublicMaxAge('/api/public/areas/kab-gresik/cameras')).toBe(30);
    });

    it('returns null for private or mutating surfaces', () => {
        expect(resolvePublicMaxAge('/api/cameras')).toBeNull();
        expect(resolvePublicMaxAge('/api/admin/settings')).toBeNull();
        expect(resolvePublicMaxAge('/api/auth/csrf')).toBeNull();
        expect(resolvePublicMaxAge('/api/stream/1500')).toBeNull();
        // Boundary safety: 'active' is exact-match, '/api/cameras/activeX' must not match.
        expect(resolvePublicMaxAge('/api/cameras/activeX')).toBeNull();
        expect(resolvePublicMaxAge('/api/areas/public')).toBe(60);
        expect(resolvePublicMaxAge('/api/areas/publicity')).toBeNull();
    });
});

describe('publicCacheHeadersMiddleware', () => {
    async function buildApp() {
        const app = Fastify();
        await app.register(publicCacheHeadersMiddleware);
        app.get('/api/cameras/active', async () => ({ ok: true }));
        app.get('/api/config/public', async () => ({ ok: true }));
        app.get('/api/admin/x', async () => ({ ok: true }));
        app.get('/api/branding/public', async (request, reply) => {
            reply.header('Cache-Control', 'no-store');
            return { ok: true };
        });
        app.post('/api/cameras/active', async () => ({ ok: true }));
        app.get('/api/fail', async (request, reply) => reply.code(500).send({ ok: false }));
        return app;
    }

    it('sets public Cache-Control on whitelisted 200 GETs only', async () => {
        const app = await buildApp();

        const hit = await app.inject({ method: 'GET', url: '/api/cameras/active?x=1' });
        expect(hit.headers['cache-control']).toBe('public, max-age=15, stale-while-revalidate=60');

        expect((await app.inject({ method: 'GET', url: '/api/config/public' }))
            .headers['cache-control']).toBe('public, max-age=60, stale-while-revalidate=240');

        // Non-GET, non-whitelisted, non-200, and self-controlled responses stay untouched.
        expect((await app.inject({ method: 'GET', url: '/api/admin/x' }))
            .headers['cache-control']).toBeUndefined();
        expect((await app.inject({ method: 'POST', url: '/api/cameras/active' }))
            .headers['cache-control']).toBeUndefined();
        expect((await app.inject({ method: 'GET', url: '/api/fail' }))
            .headers['cache-control']).toBeUndefined();
    });

    it('never overrides a Cache-Control the handler set itself', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/api/branding/public' });
        expect(res.headers['cache-control']).toBe('no-store');
    });
});
