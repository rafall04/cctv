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

    it('adds public viewer stats to landing read model without exposing private RTSP URLs', async () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 2,
                name: 'Cam B',
                private_rtsp_url: 'rtsp://private',
                live_viewers: 4,
                total_views: 18,
                total_watch_seconds: 240,
                last_viewed_at: '2026-05-05 10:00:00',
            },
        ]);

        const { default: cameraService } = await import('../services/cameraService.js');
        const rows = cameraService.getPublicLandingCameraList();

        expect(querySpy.mock.calls[0][0]).not.toContain('private_rtsp_url');
        expect(rows[0]).not.toHaveProperty('private_rtsp_url');
        /*
         * Only what a public surface renders. total_watch_seconds and last_viewed_at used to ride
         * along here AND flat on the row, read by nobody: measured against production, zero
         * references across the frontend and ~80 KB of every 737 KB response — JSON.parsed and
         * reconciled by every visitor on every refresh. Dropped from the SQL projection too.
         */
        expect(rows[0].viewer_stats).toEqual({ live_viewers: 4, total_views: 18 });
        for (const dead of ['total_watch_seconds', 'last_viewed_at']) {
            expect(rows[0], `${dead} flat`).not.toHaveProperty(dead);
            expect(rows[0].viewer_stats, `${dead} nested`).not.toHaveProperty(dead);
            expect(querySpy.mock.calls[0][0], `${dead} in SQL`).not.toContain(dead);
        }
    });

    it('strips internal health/runtime fields and never selects stream_key for the public landing list', async () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 3,
                name: 'Cam C',
                is_online: 1,
                monitoring_state: 'online',
                monitoring_reason: 'runtime_signal',
                last_runtime_signal_at: '2026-05-05 10:00:00',
                last_runtime_signal_type: 'frame',
                last_health_check_at: '2026-05-05 09:59:00',
                runtime_state_updated_at: '2026-05-05 10:00:00',
                external_health_mode: 'hybrid_probe',
                area_external_health_mode_override: 'default',
                thumbnail_path: '/thumb-c.jpg',
            },
        ]);

        const { default: cameraService } = await import('../services/cameraService.js');
        const rows = cameraService.getPublicLandingCameraList();

        // stream_key must never even be selected for the public landing list.
        expect(querySpy.mock.calls[0][0]).not.toContain('stream_key');

        const row = rows[0];
        // Public signal is kept (is_online for stats, availability_state for the card/popup).
        expect(row).toMatchObject({ id: 3, name: 'Cam C', is_online: 1, availability_state: 'online' });
        // Internal monitoring/health/runtime policy is stripped from the public payload.
        for (const field of [
            'stream_key',
            'monitoring_state',
            'monitoring_reason',
            'last_runtime_signal_at',
            'last_runtime_signal_type',
            'last_health_check_at',
            'runtime_state_updated_at',
            'health_mode',
            'external_health_mode',
            'area_external_health_mode_override',
        ]) {
            expect(row).not.toHaveProperty(field);
        }
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
