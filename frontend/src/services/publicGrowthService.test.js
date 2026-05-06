/*
 * Purpose: Verify public growth API wrapper uses public no-auth request policy.
 * Caller: Frontend focused public growth service test gate.
 * Deps: vitest, mocked apiClient, publicGrowthService.
 * MainFuncs: publicGrowthService request tests.
 * SideEffects: Mocks HTTP client.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { get: getMock },
}));

import publicGrowthService from './publicGrowthService';

describe('publicGrowthService', () => {
    beforeEach(() => {
        getMock.mockReset();
        getMock.mockResolvedValue({ data: { success: true, data: [] } });
    });

    it('loads an area using the public endpoint', async () => {
        await publicGrowthService.getArea('kab-surabaya');
        expect(getMock).toHaveBeenCalledWith('/api/public/areas/kab-surabaya', expect.objectContaining({
            skipGlobalErrorNotification: true,
            skipAuthRefresh: true,
        }));
    });

    it('loads trending cameras with area and limit params', async () => {
        await publicGrowthService.getTrendingCameras({ areaSlug: 'kab-surabaya', limit: 4 });
        expect(getMock).toHaveBeenCalledWith('/api/public/trending-cameras', expect.objectContaining({
            params: { areaSlug: 'kab-surabaya', limit: 4 },
        }));
    });

    it('loads public discovery sections with a bounded limit', async () => {
        await publicGrowthService.getDiscovery({ limit: 6 });
        expect(getMock).toHaveBeenCalledWith('/api/public/discovery', expect.objectContaining({
            skipGlobalErrorNotification: true,
            skipAuthRefresh: true,
            params: { limit: 6 },
        }));
    });
});
