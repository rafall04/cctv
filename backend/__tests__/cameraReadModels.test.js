import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';

const seedMissingRowsMock = vi.fn();
const enrichCameraAvailabilityMock = vi.fn((camera) => ({
    ...camera,
    availability_state: camera.monitoring_state || 'unknown',
}));

vi.mock('../services/cameraRuntimeStateService.js', () => ({
    default: {
        seedMissingRows: seedMissingRowsMock,
    },
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        enrichCameraAvailability: enrichCameraAvailabilityMock,
    },
}));

vi.mock('../services/cacheService.js', () => ({
    cacheGetOrSetSync: vi.fn((key, getter) => getter()),
    cacheInvalidate: vi.fn(),
    cacheKey: vi.fn((namespace, ...parts) => `${namespace}:${parts.join(':')}`),
    CacheNamespace: {
        CAMERAS: 'cameras',
        STATS: 'stats',
    },
}));

describe('cameraService read models', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        seedMissingRowsMock.mockReset();
        enrichCameraAvailabilityMock.mockClear();
    });

    it('uses lightweight landing projection joined with runtime state', async () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 1,
                name: 'Cam A',
                monitoring_state: 'online',
                thumbnail_path: '/thumb-a.jpg',
                area_name: 'Banyuwangi',
            },
        ]);

        const { default: cameraService } = await import('../services/cameraService.js');
        const rows = cameraService.getPublicLandingCameraList();

        expect(seedMissingRowsMock).toHaveBeenCalled();
        expect(querySpy).toHaveBeenCalled();
        expect(querySpy.mock.calls[0][0]).toContain('LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id');
        expect(querySpy.mock.calls[0][0]).not.toContain('SELECT c.*');
        expect(rows[0]).toMatchObject({
            id: 1,
            name: 'Cam A',
            availability_state: 'online',
        });
    });

    it('loads camera detail with full config plus runtime state', async () => {
        const queryOneSpy = vi.spyOn(connectionPool, 'queryOne').mockReturnValue({
            id: 9,
            name: 'Cam Detail',
            private_rtsp_url: 'rtsp://private',
            monitoring_state: 'offline',
            monitoring_reason: 'health_check_offline',
            area_name: 'Tasikmalaya',
        });

        const { default: cameraService } = await import('../services/cameraService.js');
        const row = cameraService.getCameraDetailById(9);

        expect(seedMissingRowsMock).toHaveBeenCalled();
        expect(queryOneSpy).toHaveBeenCalledWith(
            expect.stringContaining('LEFT JOIN camera_runtime_state crs ON crs.camera_id = c.id'),
            [9]
        );
        expect(row).toMatchObject({
            id: 9,
            name: 'Cam Detail',
            monitoring_reason: 'health_check_offline',
            availability_state: 'offline',
        });
    });
});
