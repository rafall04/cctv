/**
 * Purpose: Verify public settings routes stay available without admin authentication.
 * Caller: Backend focused settings route test gate.
 * Deps: Fastify, vitest, settingsRoutes.
 * MainFuncs: Public timezone route behavior tests.
 * SideEffects: Mocks timezone database reads.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    queryOne: queryOneMock,
    execute: vi.fn(),
}));

/*
 * The real authMiddleware wants a signed JWT, a users table and a session store to say "no". The
 * rule under test is only WHICH guards a route sits behind, so both are stubbed to a deterministic
 * answer and their identity is what the assertions read. The public-route test above is unaffected:
 * those routes carry neither guard.
 */
vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: async (request, reply) => {
        if (!request.headers['x-test-user']) {
            return reply.code(401).send({ success: false, message: 'unauthenticated' });
        }
        request.user = { id: 1, role: request.headers['x-test-user'] };
        return undefined;
    },
    requireAdmin: async (request, reply) => {
        if (request.user?.role !== 'admin') {
            return reply.code(403).send({ success: false, message: 'admin only' });
        }
        return undefined;
    },
}));

describe('settingsRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        queryOneMock.mockReset();
    });

    it('serves timezone settings publicly without requiring admin auth', async () => {
        queryOneMock.mockReturnValue({ setting_value: 'Asia/Makassar' });

        const { default: settingsRoutes } = await import('../routes/settingsRoutes.js');
        const fastify = Fastify();
        await fastify.register(settingsRoutes);

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/settings/timezone',
        });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({
            success: true,
            data: {
                timezone: 'Asia/Makassar',
                shortName: 'WITA',
            },
        });

        await fastify.close();
    });
});

/*
 * REGRESSION (public-surface sweep, 2026-08-20): the two settings READS required only a login while
 * the PUT beside them required admin — so a `viewer` account could read every secret it was not
 * allowed to change.
 *
 * That matters because `settings` is a credential-bearing table by design: telegramService writes
 * the bot token into the `telegram_config` row here, and getAllSettings is `SELECT * FROM settings`
 * with no masking of any kind between the query and the response. `/:key` is the sharper edge — a
 * caller can name `telegram_config` directly rather than hunting for it in a list.
 *
 * Every consumer in the app is an adminOnly settings or billing panel, so the gate costs nothing.
 */
describe('settingsRoutes — bacaan bertoken kredensial hanya untuk admin', () => {
    const mount = async () => {
        const { default: settingsRoutes } = await import('../routes/settingsRoutes.js');
        const fastify = Fastify();
        await fastify.register(settingsRoutes);
        return fastify;
    };

    it.each(['/api/settings', '/api/settings/telegram_config'])(
        'GET %s menolak pemanggil anonim',
        async (url) => {
            const fastify = await mount();
            expect((await fastify.inject({ method: 'GET', url })).statusCode).toBe(401);
        },
    );

    it.each(['/api/settings', '/api/settings/telegram_config'])(
        'GET %s menolak viewer yang sudah login',
        async (url) => {
            const fastify = await mount();
            const response = await fastify.inject({
                method: 'GET', url, headers: { 'x-test-user': 'viewer' },
            });

            expect(response.statusCode).toBe(403);
        },
    );

    /* The four narrow public reads must stay open — the gate is on the two broad ones only. */
    it.each([
        '/api/settings/map-center',
        '/api/settings/landing-page',
        '/api/settings/public-ads',
        '/api/settings/timezone',
    ])('GET %s tetap publik', async (url) => {
        queryOneMock.mockReturnValue({ setting_value: 'Asia/Jakarta' });
        const fastify = await mount();

        expect((await fastify.inject({ method: 'GET', url })).statusCode).not.toBe(401);
    });
});
