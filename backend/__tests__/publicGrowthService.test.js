/**
 * Purpose: Verify public growth read models are sanitized and ordered correctly.
 * Caller: Backend focused public growth test gate.
 * Deps: vitest, mocked connectionPool, publicGrowthService.
 * MainFuncs: Public area, camera sanitization, trending, and discovery tests.
 * SideEffects: Mocks database reads.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, queryOneMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('publicGrowthService', () => {
    beforeEach(() => {
        vi.resetModules();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('returns a public area by slug with computed counts', async () => {
        queryOneMock.mockReturnValue({
            id: 7,
            name: 'KAB SURABAYA',
            slug: 'kab-surabaya',
            camera_count: 2,
            online_count: 1,
            total_views: 12,
        });

        const service = await import('../services/publicGrowthService.js');

        expect(service.getPublicAreaBySlug('kab-surabaya')).toEqual({
            id: 7,
            name: 'KAB SURABAYA',
            slug: 'kab-surabaya',
            camera_count: 2,
            online_count: 1,
            total_views: 12,
            description: 'Pantau CCTV publik area KAB SURABAYA secara online melalui RAF NET.',
        });
    });

    it('does not expose private camera source fields', async () => {
        queryOneMock.mockReturnValue({ id: 7, name: 'KAB SURABAYA', slug: 'kab-surabaya' });
        queryMock.mockReturnValue([
            {
                id: 1,
                name: 'CCTV A',
                area_name: 'KAB SURABAYA',
                area_slug: 'kab-surabaya',
                location: 'Jalan A',
                status: 'online',
                stream_key: 'camera-a',
                rtsp_url: 'rtsp://admin:secret@10.0.0.1',
                username: 'admin',
                password: 'secret',
                total_views: 9,
                live_viewers: 1,
            },
        ]);

        const service = await import('../services/publicGrowthService.js');
        const cameras = service.getPublicAreaCameras('kab-surabaya');

        expect(cameras).toHaveLength(1);
        expect(cameras[0]).toMatchObject({
            id: 1,
            name: 'CCTV A',
            area_name: 'KAB SURABAYA',
            area_slug: 'kab-surabaya',
            total_views: 9,
            live_viewers: 1,
            viewer_stats: {
                total_views: 9,
                live_viewers: 1,
            },
        });
        expect(cameras[0]).not.toHaveProperty('rtsp_url');
        expect(cameras[0]).not.toHaveProperty('username');
        expect(cameras[0]).not.toHaveProperty('password');
    });

    it('limits trending cameras and filters by area slug', async () => {
        queryMock.mockReturnValue([{ id: 1, name: 'CCTV A', total_views: 30 }]);
        const service = await import('../services/publicGrowthService.js');

        expect(service.getTrendingCameras({ areaSlug: 'kab-surabaya', limit: 4 })).toEqual([
            expect.objectContaining({ id: 1, name: 'CCTV A', total_views: 30 }),
        ]);
        expect(queryMock.mock.calls[0][1]).toEqual(['kab-surabaya', 4]);
    });

    it('throws 404 for unknown area slug', async () => {
        queryOneMock.mockReturnValue(null);
        const service = await import('../services/publicGrowthService.js');

        expect(() => service.getPublicAreaBySlug('hilang')).toThrow('Area hilang tidak ditemukan');
    });

    it('builds public discovery sections with sanitized cameras and popular areas', async () => {
        queryMock
            .mockReturnValueOnce([{ id: 1, name: 'Live A', live_viewers: 3, total_views: 40 }])
            .mockReturnValueOnce([{ id: 2, name: 'Top B', live_viewers: 1, total_views: 90 }])
            .mockReturnValueOnce([{ id: 3, name: 'New C', created_at: '2026-05-06 08:00:00', total_views: 4 }])
            .mockReturnValueOnce([{
                id: 7,
                name: 'KAB SURABAYA',
                slug: 'kab-surabaya',
                camera_count: 12,
                online_count: 10,
                live_viewers: 5,
                total_views: 120,
                latest_camera_at: '2026-05-06 08:00:00',
            }]);

        const service = await import('../services/publicGrowthService.js');
        const discovery = service.getPublicDiscovery({ limit: 6 });

        expect(discovery.live_now).toEqual([expect.objectContaining({ id: 1, name: 'Live A', live_viewers: 3 })]);
        expect(discovery.top_cameras).toEqual([expect.objectContaining({ id: 2, name: 'Top B', total_views: 90 })]);
        expect(discovery.new_cameras).toEqual([expect.objectContaining({ id: 3, name: 'New C', created_at: '2026-05-06 08:00:00' })]);
        expect(discovery.popular_areas).toEqual([
            expect.objectContaining({
                id: 7,
                name: 'KAB SURABAYA',
                slug: 'kab-surabaya',
                camera_count: 12,
                online_count: 10,
                live_viewers: 5,
                total_views: 120,
            }),
        ]);
        expect(queryMock).toHaveBeenCalledTimes(4);
    });
});
