/**
 * Purpose: Verify the vehicle-count endpoint is actually reachable at /api/public/vehicle-count/:cameraId.
 * Caller: Backend focused public route test gate.
 * Deps: Fastify, vitest, publicGrowthRoutes.
 * MainFuncs: Public route mount + response shape tests.
 * SideEffects: Mocks vehicleCountService.
 *
 * It is registered NESTED inside publicGrowthRoutes (to keep server.js under the 800-line
 * ratchet), so the mount path is the easy thing to break silently. This test is the guard.
 */

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPublicVehicleCountMock } = vi.hoisted(() => ({
    getPublicVehicleCountMock: vi.fn(),
}));

vi.mock('../services/vehicleCountService.js', () => ({
    getPublicVehicleCount: getPublicVehicleCountMock,
    isVehicleCountCamera: vi.fn(),
}));

async function buatServer() {
    const { default: publicGrowthRoutes } = await import('../routes/publicGrowthRoutes.js');
    const fastify = Fastify();
    await fastify.register(publicGrowthRoutes, { prefix: '/api/public' });
    return fastify;
}

describe('vehicleCountRoutes', () => {
    beforeEach(() => {
        vi.resetModules();
        getPublicVehicleCountMock.mockReset();
    });

    it('serves the vehicle count without auth, under the public prefix', async () => {
        getPublicVehicleCountMock.mockReturnValue({ cameraId: 15, tersedia: true, total: 1284 });
        const fastify = await buatServer();

        const response = await fastify.inject({ method: 'GET', url: '/api/public/vehicle-count/15' });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ success: true, data: { cameraId: 15, total: 1284 } });
        expect(getPublicVehicleCountMock).toHaveBeenCalledWith('15');
        await fastify.close();
    });

    it('reports unavailable rather than failing for a camera without counting', async () => {
        getPublicVehicleCountMock.mockReturnValue({ cameraId: 16, tersedia: false });
        const fastify = await buatServer();

        const response = await fastify.inject({ method: 'GET', url: '/api/public/vehicle-count/16' });

        expect(response.statusCode).toBe(200);
        expect(response.json().data).toEqual({ cameraId: 16, tersedia: false });
        await fastify.close();
    });

    it('passes a 404 from the community gate through to the caller', async () => {
        const error = new Error('Kamera tidak ditemukan');
        error.statusCode = 404;
        getPublicVehicleCountMock.mockImplementation(() => { throw error; });
        const fastify = await buatServer();

        const response = await fastify.inject({ method: 'GET', url: '/api/public/vehicle-count/999' });

        expect(response.statusCode).toBe(404);
        expect(response.json()).toMatchObject({ success: false, message: 'Kamera tidak ditemukan' });
        await fastify.close();
    });

    it('still serves the other public growth routes it is nested inside', async () => {
        const fastify = await buatServer();
        const tree = fastify.printRoutes();

        expect(tree).toContain('vehicle-count');
        expect(tree).toContain('trending-cameras');
        await fastify.close();
    });
});
