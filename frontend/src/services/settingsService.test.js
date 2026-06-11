import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { getMock, putMock } = vi.hoisted(() => ({
    getMock: vi.fn(),
    putMock: vi.fn(),
}));

vi.mock('./apiClient', () => ({
    default: { get: getMock, put: putMock },
}));

import { settingsService, invalidateMapCenterCache } from './settingsService';

describe('settingsService.getMapCenter cache', () => {
    beforeEach(() => {
        getMock.mockReset();
        putMock.mockReset();
        invalidateMapCenterCache();
        getMock.mockResolvedValue({ data: { success: true, data: { latitude: -7.15, longitude: 111.88, zoom: 11 } } });
        putMock.mockResolvedValue({ data: { success: true } });
    });

    afterEach(() => {
        invalidateMapCenterCache();
    });

    it('fetches once and serves repeated opens from cache', async () => {
        const a = await settingsService.getMapCenter();
        const b = await settingsService.getMapCenter();
        const c = await settingsService.getMapCenter();

        expect(a.data.latitude).toBe(-7.15);
        expect(b).toEqual(a);
        expect(c).toEqual(a);
        expect(getMock).toHaveBeenCalledTimes(1); // <-- no round-trip per modal open
    });

    it('dedupes concurrent in-flight requests into a single fetch', async () => {
        const [a, b] = await Promise.all([
            settingsService.getMapCenter(),
            settingsService.getMapCenter(),
        ]);
        expect(a).toEqual(b);
        expect(getMock).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed response', async () => {
        getMock.mockResolvedValueOnce({ data: { success: false, message: 'nope' } });
        await settingsService.getMapCenter();
        await settingsService.getMapCenter();
        expect(getMock).toHaveBeenCalledTimes(2); // retried because first was not cached
    });

    it('busts the cache after updateMapCenter so the new center is read fresh', async () => {
        await settingsService.getMapCenter();
        expect(getMock).toHaveBeenCalledTimes(1);

        await settingsService.updateMapCenter(-8, 112, 12, 'Baru');
        await settingsService.getMapCenter();
        expect(getMock).toHaveBeenCalledTimes(2);
    });
});
