/**
 * Purpose: Verify csrfProtection honors the CSRF_ENABLED kill-switch.
 * Caller: Vitest backend suite.
 * Deps: middleware/csrfProtection.js re-imported per test with mutated env.
 * MainFuncs: csrfMiddleware via fastify inject.
 * SideEffects: None beyond per-test env mutation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';

const ORIGINAL_ENV = { ...process.env };

async function loadCsrf(envOverrides) {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, ...envOverrides };
    return import('../middleware/csrfProtection.js');
}

describe('csrfProtection — CSRF_ENABLED wiring', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('CSRF_ENABLED=false lets a tokenless POST through', async () => {
        const { csrfMiddleware } = await loadCsrf({ CSRF_ENABLED: 'false' });
        const app = Fastify();
        await app.register(csrfMiddleware);
        app.post('/api/cameras', async () => ({ ok: true }));
        const res = await app.inject({ method: 'POST', url: '/api/cameras', payload: {} });
        expect(res.statusCode).toBe(200);
        await app.close();
    });

    it('CSRF_ENABLED=true rejects a tokenless POST with 403', async () => {
        const { csrfMiddleware } = await loadCsrf({ CSRF_ENABLED: 'true' });
        const app = Fastify();
        await app.register(csrfMiddleware);
        app.post('/api/cameras', async () => ({ ok: true }));
        const res = await app.inject({ method: 'POST', url: '/api/cameras', payload: {} });
        expect(res.statusCode).toBe(403);
        await app.close();
    });

    it('CSRF_ENABLED=true still allows GET (non-state-changing)', async () => {
        const { csrfMiddleware } = await loadCsrf({ CSRF_ENABLED: 'true' });
        const app = Fastify();
        await app.register(csrfMiddleware);
        app.get('/api/cameras', async () => ({ ok: true }));
        const res = await app.inject({ method: 'GET', url: '/api/cameras' });
        expect(res.statusCode).toBe(200);
        await app.close();
    });
});
