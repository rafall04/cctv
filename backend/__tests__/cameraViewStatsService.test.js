/**
 * Purpose: Verify compact per-camera live view counters and public viewer stats aggregates.
 * Caller: Backend focused test gate for camera view stats.
 * Deps: vitest, connectionPool mock, cameraViewStatsService.
 * MainFuncs: cameraViewStatsService behavior tests.
 * SideEffects: Mocks database/cache calls only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';

const cacheInvalidateMock = vi.fn();

vi.mock('../services/cacheService.js', () => ({
    cacheGetOrSetSync: vi.fn((key, getter) => getter()),
    cacheInvalidate: cacheInvalidateMock,
    cacheKey: vi.fn((namespace, ...parts) => `${namespace}:${parts.join(':')}`),
    CacheNamespace: {
        STATS: 'stats',
    },
    CacheTTL: {
        SHORT: 30000,
    },
}));

describe('cameraViewStatsService', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        cacheInvalidateMock.mockClear();
    });

    it('upserts a completed live view without scanning history', async () => {
        const executeSpy = vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        const { default: cameraViewStatsService } = await import('../services/cameraViewStatsService.js');

        cameraViewStatsService.recordCompletedLiveView({
            cameraId: 1168,
            durationSeconds: 45,
            viewedAt: '2026-05-05 12:30:00',
        });

        expect(executeSpy).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(camera_id) DO UPDATE SET'),
            [1168, 45, '2026-05-05 12:30:00', '2026-05-05 12:30:00', '2026-05-05 12:30:00']
        );
        expect(cacheInvalidateMock).toHaveBeenCalledWith('stats:camera_view_stats');
    });

    it('loads public stats in one aggregate query keyed by camera id', async () => {
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                camera_id: 1,
                live_viewers: 2,
                total_views: 9,
                total_watch_seconds: 120,
                last_viewed_at: '2026-05-05 12:30:00',
            },
            {
                camera_id: 2,
                live_viewers: 0,
                total_views: null,
                total_watch_seconds: null,
                last_viewed_at: null,
            },
        ]);
        const { default: cameraViewStatsService } = await import('../services/cameraViewStatsService.js');

        const stats = cameraViewStatsService.getPublicStatsByCamera();

        expect(connectionPool.query).toHaveBeenCalledTimes(1);
        expect(connectionPool.query.mock.calls[0][0]).toContain('LEFT JOIN camera_view_stats cvs');
        expect(connectionPool.query.mock.calls[0][0]).toContain('SELECT camera_id, COUNT(*) as viewer_count');
        expect(stats).toEqual({
            1: {
                live_viewers: 2,
                total_views: 9,
                total_watch_seconds: 120,
                last_viewed_at: '2026-05-05 12:30:00',
            },
            2: {
                live_viewers: 0,
                total_views: 0,
                total_watch_seconds: 0,
                last_viewed_at: null,
            },
        });
    });
});
