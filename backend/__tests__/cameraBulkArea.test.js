/*
Purpose: Regression coverage for Area Management bulk camera updates.
Caller: Vitest backend suite.
Deps: connectionPool mocks, cameraService.bulkUpdateArea().
MainFuncs: createMixedAreaCameras(), cameraService.bulkUpdateArea behavior assertions.
SideEffects: Mocks database reads/writes and camera update calls during tests.
*/

import { afterEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';

function createMixedAreaCameras() {
    return [
        {
            id: 11,
            name: 'Cam Internal',
            area_id: 7,
            enabled: 1,
            is_online: 1,
            enable_recording: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://internal/cam-11',
            external_hls_url: null,
            external_stream_url: null,
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 12,
            name: 'Cam HLS',
            area_id: 7,
            enabled: 1,
            is_online: 1,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: 'external_hls',
            private_rtsp_url: null,
            external_hls_url: 'https://example.com/cam-12/index.m3u8',
            external_stream_url: 'https://example.com/cam-12/index.m3u8',
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 13,
            name: 'Cam MJPEG',
            area_id: 7,
            enabled: 1,
            is_online: 0,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            private_rtsp_url: null,
            external_hls_url: null,
            external_stream_url: 'https://example.com/cam-13/live.mjpeg',
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
        {
            id: 14,
            name: 'Cam Unresolved',
            area_id: 7,
            enabled: 1,
            is_online: 0,
            enable_recording: 0,
            stream_source: 'external',
            delivery_type: null,
            private_rtsp_url: null,
            external_hls_url: null,
            external_stream_url: null,
            external_embed_url: null,
            external_snapshot_url: null,
            external_health_mode: 'default',
        },
    ];
}

describe('cameraService.bulkUpdateArea', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('menormalkan target filter proxy policy ke external_hls_only saat preview', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Gresik' });
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 12,
                name: 'Cam HLS',
                area_id: 7,
                is_online: 1,
                enable_recording: 0,
                stream_source: 'external',
                delivery_type: 'external_hls',
                private_rtsp_url: null,
                external_hls_url: 'https://example.com/index.m3u8',
                external_stream_url: 'https://example.com/index.m3u8',
                external_embed_url: null,
                external_snapshot_url: null,
            },
        ]);

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                external_use_proxy: 1,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('external_hls_only');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 1,
            matchedCount: 1,
            eligibleCount: 1,
            blockedCount: 0,
        }));
    });

    it('menormalkan target filter health policy ke external_streams_only saat preview', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Jombang' });
        vi.spyOn(connectionPool, 'query').mockReturnValue([
            {
                id: 12,
                name: 'Cam MJPEG',
                area_id: 7,
                is_online: 1,
                enable_recording: 0,
                stream_source: 'external',
                delivery_type: 'external_mjpeg',
                private_rtsp_url: null,
                external_hls_url: null,
                external_stream_url: 'https://example.com/live.mjpeg',
                external_embed_url: null,
                external_snapshot_url: null,
                external_health_mode: 'default',
            },
            {
                id: 13,
                name: 'Cam Internal',
                area_id: 7,
                is_online: 1,
                enable_recording: 1,
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                private_rtsp_url: 'rtsp://internal',
                external_hls_url: null,
                external_stream_url: null,
                external_embed_url: null,
                external_snapshot_url: null,
                external_health_mode: 'default',
            },
        ]);

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                external_health_mode: 'passive_first',
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('external_streams_only');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 2,
            matchedCount: 1,
            eligibleCount: 1,
            blockedCount: 0,
        }));
        expect(result.summary.externalHealthModeBreakdown).toEqual([
            expect.objectContaining({ key: 'default', count: 1 }),
        ]);
    });

    it('mengizinkan bulk status publik matikan untuk mixed area tanpa external-only lock', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enabled: 0,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 4,
            blockedCount: 0,
        }));
        expect(result.summary.blockedReasons).toEqual([]);
    });

    it('mengizinkan bulk recording matikan untuk mixed area tanpa internal-only block', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 0,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 4,
            blockedCount: 0,
        }));
        expect(result.summary.blockedReasons).toEqual([]);
    });

    it('tetap membatasi bulk recording aktifkan hanya untuk kamera internal', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 1,
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.targetFilter).toBe('all');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 4,
            eligibleCount: 1,
            blockedCount: 3,
        }));
        expect(result.summary.blockedReasons).toEqual([
            { reason: 'internal_only_policy', count: 3 },
        ]);
        expect(result.summary.blockedExamples).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 12, reason: 'internal_only_policy' }),
            expect.objectContaining({ id: 13, reason: 'internal_only_policy' }),
            expect.objectContaining({ id: 14, reason: 'internal_only_policy' }),
        ]));
    });

    it('mengarahkan health monitoring disabled ke external valid dan memberi summary jelas', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                external_health_mode: 'disabled',
            },
            preview: true,
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.preview).toBe(true);
        expect(result.requestedTargetFilter).toBe('all');
        expect(result.targetFilter).toBe('external_streams_only');
        expect(result.summary).toEqual(expect.objectContaining({
            totalInArea: 4,
            matchedCount: 2,
            eligibleCount: 2,
            blockedCount: 0,
        }));
        expect(result.guidance).toContain('external_streams_only');
        expect(result.guidance).toContain('health monitoring policy');
    });

    it('apply bulk recording matikan mengirim patch ke semua kamera mixed area', async () => {
        vi.spyOn(connectionPool, 'queryOne').mockReturnValue({ id: 7, name: 'Area Mixed' });
        vi.spyOn(connectionPool, 'query').mockReturnValue(createMixedAreaCameras());
        vi.spyOn(connectionPool, 'execute').mockReturnValue({ changes: 1 });
        vi.spyOn(cameraService, 'invalidateCameraCache').mockImplementation(() => {});
        const updateSpy = vi.spyOn(cameraService, 'updateCamera').mockResolvedValue({ success: true });

        const result = await cameraService.bulkUpdateArea(7, {
            targetFilter: 'all',
            operation: 'policy_update',
            payload: {
                enable_recording: 0,
            },
        }, { user: { id: 1 }, ip: '127.0.0.1' });

        expect(result.success).toBe(true);
        expect(result.changes).toBe(4);
        expect(updateSpy).toHaveBeenCalledTimes(4);
        expect(updateSpy).toHaveBeenNthCalledWith(1, 11, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(2, 12, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(3, 13, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
        expect(updateSpy).toHaveBeenNthCalledWith(4, 14, expect.objectContaining({ enable_recording: 0 }), expect.any(Object), expect.any(Object));
    });
});
