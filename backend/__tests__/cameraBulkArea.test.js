import { afterEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraService from '../services/cameraService.js';

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
});
