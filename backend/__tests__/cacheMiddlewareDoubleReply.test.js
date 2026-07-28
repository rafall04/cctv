/*
 * Purpose: Lock in that a cacheMiddleware HIT does not let the route handler send a SECOND reply.
 * Caller:  Backend Vitest suite.
 * Deps:    real fastify instance via inject(), cacheMiddleware.
 * MainFuncs: cache-hit double-reply regression tests.
 * SideEffects: None — in-process injections, no sockets, no DB.
 *
 * The bug this guards (production: ~113 ERR_HTTP_HEADERS_SENT + unhandledRejection per day):
 * on a cache HIT the middleware called reply.send() and then `return;`. Resolving undefined does
 * not stop Fastify's preHandler chain — Fastify only skips the handler when `reply.sent` is true,
 * and `reply.sent` is `(hijacked || raw.writableEnded)`, which flips when the SOCKET write ends.
 *
 * The ASYNC onSend hooks below are load-bearing, not decoration: they mirror the two this app
 * registers (server.js voucher cache-control + middleware/securityHeaders.js). An async onSend
 * defers writeHead/end to a later microtask, so `reply.sent` is still false when Fastify decides
 * whether to run the handler. WITHOUT these hooks Fastify silently absorbs the second send and
 * this test would pass against the broken code — which is exactly why the bug survived so long.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { cacheMiddleware, invalidateCache } from '../middleware/cacheMiddleware.js';

const rejections = [];
const recordRejection = (reason) => rejections.push(reason);

function buildApp() {
    const app = Fastify({ logger: false });

    // Mirrors the two real async onSend hooks. Async is the whole point — see header.
    app.addHook('onSend', async (_request, reply, payload) => {
        reply.header('x-test-hook-a', '1');
        return payload;
    });
    app.addHook('onSend', async (_request, reply, payload) => {
        reply.header('x-test-hook-b', '1');
        return payload;
    });

    let handlerCalls = 0;
    app.get('/api/cameras/active', { preHandler: cacheMiddleware(30) }, async (_request, reply) => {
        handlerCalls += 1;
        return reply.send({ success: true, data: [{ id: 1 }] });
    });

    return { app, handlerCalls: () => handlerCalls };
}

afterEach(() => {
    rejections.length = 0;
    process.off('unhandledRejection', recordRejection);
    invalidateCache('/api/cameras');
    vi.restoreAllMocks();
});

describe('cacheMiddleware — cache HIT must not double-send', () => {
    it('REGRESSION: a HIT raises no ERR_HTTP_HEADERS_SENT and no unhandledRejection', async () => {
        process.on('unhandledRejection', recordRejection);
        const { app } = buildApp();

        const miss = await app.inject({ method: 'GET', url: '/api/cameras/active' });
        expect(miss.statusCode).toBe(200);
        expect(miss.headers['x-cache']).toBe('MISS');

        const hit = await app.inject({ method: 'GET', url: '/api/cameras/active' });
        expect(hit.statusCode).toBe(200);
        expect(hit.headers['x-cache']).toBe('HIT');

        // Let any deferred microtask rejection surface before asserting.
        await new Promise((resolve) => setImmediate(resolve));

        expect(
            rejections.map((error) => error?.code || String(error)),
            'a cache HIT triggered a second reply'
        ).toEqual([]);

        await app.close();
    });

    it('does not run the route handler again on a HIT', async () => {
        const { app, handlerCalls } = buildApp();

        await app.inject({ method: 'GET', url: '/api/cameras/active' });
        expect(handlerCalls()).toBe(1);

        await app.inject({ method: 'GET', url: '/api/cameras/active' });
        // The whole point of the cache: the handler must NOT be entered a second time.
        expect(handlerCalls(), 'handler ran again on a cache HIT — that is the double-send').toBe(1);

        await app.close();
    });

    it('serves the cached body unchanged, and still runs the onSend hooks', async () => {
        const { app } = buildApp();

        const miss = await app.inject({ method: 'GET', url: '/api/cameras/active' });
        const hit = await app.inject({ method: 'GET', url: '/api/cameras/active' });

        expect(hit.json()).toEqual(miss.json());
        expect(hit.headers['x-test-hook-a']).toBe('1');
        expect(hit.headers['x-test-hook-b']).toBe('1');

        await app.close();
    });

    it('a burst of concurrent HITs stays clean (the production trigger shape)', async () => {
        process.on('unhandledRejection', recordRejection);
        const { app } = buildApp();

        await app.inject({ method: 'GET', url: '/api/cameras/active' });
        const burst = await Promise.all(
            Array.from({ length: 12 }, () => app.inject({ method: 'GET', url: '/api/cameras/active' }))
        );

        await new Promise((resolve) => setImmediate(resolve));

        expect(burst.every((response) => response.statusCode === 200)).toBe(true);
        expect(rejections).toEqual([]);

        await app.close();
    });
});
