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

vi.mock('../database/database.js', () => ({
    queryOne: queryOneMock,
    execute: vi.fn(),
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
