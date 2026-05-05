/**
 * Purpose: Verify public growth endpoints respond without admin authentication.
 * Caller: Backend focused public growth route test gate.
 * Deps: Fastify, vitest, publicGrowthRoutes.
 * MainFuncs: Public route behavior tests.
 * SideEffects: Mocks publicGrowthService.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    getPublicAreaBySlugMock,
    getPublicAreaCamerasMock,
    getTrendingCamerasMock,
} = vi.hoisted(() => ({
    getPublicAreaBySlugMock: vi.fn(),
    getPublicAreaCamerasMock: vi.fn(),
    getTrendingCamerasMock: vi.fn(),
}));

vi.mock('../services/publicGrowthService.js', () => ({
    getPublicAreaBySlug: getPublicAreaBySlugMock,
    getPublicAreaCameras: getPublicAreaCamerasMock,
    getTrendingCameras: getTrendingCamerasMock,
}));

describe('publicGrowthRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        getPublicAreaBySlugMock.mockReset();
        getPublicAreaCamerasMock.mockReset();
        getTrendingCamerasMock.mockReset();
    });

    it('serves public area data without auth', async () => {
        getPublicAreaBySlugMock.mockReturnValue({ name: 'KAB SURABAYA', slug: 'kab-surabaya' });
        const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
        const fastify = Fastify();
        await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });

        const response = await fastify.inject({ method: 'GET', url: '/api/public/areas/kab-surabaya' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, data: { slug: 'kab-surabaya' } });
        await fastify.close();
    });

    it('returns 404 for unknown public area', async () => {
        const error = new Error('Area hilang tidak ditemukan');
        error.statusCode = 404;
        getPublicAreaBySlugMock.mockImplementation(() => { throw error; });
        const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
        const fastify = Fastify();
        await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });

        const response = await fastify.inject({ method: 'GET', url: '/api/public/areas/hilang' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ success: false, message: 'Area hilang tidak ditemukan' });
        await fastify.close();
    });

    it('passes area and limit query to trending service', async () => {
        getTrendingCamerasMock.mockReturnValue([{ id: 1, name: 'CCTV A' }]);
        const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
        const fastify = Fastify();
        await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });

        const response = await fastify.inject({
            method: 'GET',
            url: '/api/public/trending-cameras?areaSlug=kab-surabaya&limit=4',
        });

        expect(response.statusCode).toBe(200);
        expect(getTrendingCamerasMock).toHaveBeenCalledWith({ areaSlug: 'kab-surabaya', limit: '4' });
        await fastify.close();
    });
});
