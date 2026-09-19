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

    describe('playback camera picker read model', () => {
        it('scopes the public list to enabled community recording cameras only', async () => {
            const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([]);

            const { default: cameraService } = await import('../services/cameraService.js');
            cameraService.getPlaybackCameraList(null);

            const sql = querySpy.mock.calls[0][0];
            expect(sql).toContain('c.enable_recording = 1');
            expect(sql).toContain('c.enabled = 1');
            expect(sql).toContain("c.camera_class = 'community'");
            // No subscriber escape hatch — the public ARCHIVE rule is stricter than the live list.
            expect(sql).not.toContain('billing_status');
        });

        it('scopes the admin list to every recording camera', async () => {
            const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([
                { id: 7, name: 'Owner Cam', camera_class: 'owner_private', enable_recording: 1 },
            ]);

            const { default: cameraService } = await import('../services/cameraService.js');
            const rows = cameraService.getPlaybackCameraList({ role: 'admin' });

            const sql = querySpy.mock.calls[0][0];
            expect(sql).toContain('c.enable_recording = 1');
            // Admin playback replays any recording camera — no community/enabled restriction.
            // (c.camera_class IS still selected as a column; only the WHERE filter is absent.)
            expect(sql).not.toContain("camera_class = 'community'");
            expect(sql).not.toContain('c.enabled = 1');
            expect(rows).toHaveLength(1);
            expect(rows[0]).toMatchObject({ id: 7, camera_class: 'owner_private' });
        });

        it('selects only picker fields — no credentials, runtime state, or source URLs', async () => {
            const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([]);

            const { default: cameraService } = await import('../services/cameraService.js');
            cameraService.getPlaybackCameraList({ role: 'admin' });

            const sql = querySpy.mock.calls[0][0];
            for (const field of [
                'private_rtsp_url',
                'stream_key',
                'external_hls_url',
                'external_stream_url',
                'external_embed_url',
                'owner_user_id',
                'billing_status',
                'sponsor_id',
            ]) {
                expect(sql, field).not.toContain(field);
            }
            // Runtime/monitoring joins are what made the admin list fat — none here.
            expect(sql).not.toContain('camera_runtime_state');
            expect(sql).not.toContain('viewer_sessions');
            // The fields the picker actually reads must be selected.
            for (const field of ['c.id', 'c.name', 'c.location', 'c.area_id', 'c.enable_recording', 'c.camera_class', 'c.video_codec', 'c.thumbnail_path', 'c.thumbnail_updated_at', 'c.external_snapshot_url', 'area_name']) {
                expect(sql, field).toContain(field);
            }
        });

        it('strips userinfo credentials from external_snapshot_url for anonymous callers', async () => {
            vi.spyOn(connectionPool, 'query').mockReturnValue([
                {
                    id: 5,
                    name: 'Cam E',
                    camera_class: 'community',
                    enable_recording: 1,
                    external_snapshot_url: 'https://user:secret@cam.example/snap.jpg',
                },
            ]);

            const { default: cameraService } = await import('../services/cameraService.js');
            const rows = cameraService.getPlaybackCameraList(null);

            expect(rows[0].external_snapshot_url).not.toContain('user:secret');
            expect(rows[0].external_snapshot_url).toContain('cam.example');
        });
    });
});
