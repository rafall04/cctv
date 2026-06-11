/**
 * Purpose: Verify public area route behavior for public landing stability.
 * Caller: Backend focused public route test gate.
 * Deps: Fastify, vitest, areaRoutes with mocked area controller.
 * MainFuncs: areaRoutes public cache regression tests.
 * SideEffects: Uses in-memory Fastify route injection only.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublicAreasMock } = vi.hoisted(() => ({
    getPublicAreasMock: vi.fn(),
}));

vi.mock('../controllers/areaController.js', () => ({
    getAllAreas: vi.fn(),
    getPublicAreas: getPublicAreasMock,
    getAreaById: vi.fn(),
    createArea: vi.fn(),
    updateArea: vi.fn(),
    deleteArea: vi.fn(),
    getAreaFilters: vi.fn(),
    getAreaAdminOverview: vi.fn(),
    getAreaSummary: vi.fn(),
}));

vi.mock('../middleware/authMiddleware.js', () => ({
    authMiddleware: vi.fn(async () => {}),
    requireAdmin: vi.fn(async () => {}),
}));

vi.mock('../middleware/schemaValidators.js', () => ({
    createAreaSchema: {},
    updateAreaSchema: {},
    areaIdParamSchema: {},
}));

describe('areaRoutes public cache', () => {
    beforeEach(() => {
        getPublicAreasMock.mockReset();
        getPublicAreasMock.mockImplementation((_request, reply) => reply.send({
            success: true,
            data: [{ id: 1, name: 'Area 1' }],
        }));
    });

    it('caches public area list responses for repeated landing refreshes', async () => {
        const { default: areaRoutes } = await import('../routes/areaRoutes.js');
        const fastify = Fastify();
        await fastify.register(areaRoutes, { prefix: '/api/areas' });

        const first = await fastify.inject({ method: 'GET', url: '/api/areas/public' });
        const second = await fastify.inject({ method: 'GET', url: '/api/areas/public' });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(200);
        expect(first.headers['x-cache']).toBe('MISS');
        expect(second.headers['x-cache']).toBe('HIT');
        expect(getPublicAreasMock).toHaveBeenCalledTimes(1);
        await fastify.close();
    });
});
