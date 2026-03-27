import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraHealthService from '../services/cameraHealthService.js';
import areaService from '../services/areaService.js';

describe('areaService.getAdminOverview', () => {
    beforeEach(() => {
        areaService.invalidateAreaCache();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        areaService.invalidateAreaCache();
    });

    it('mengembalikan overview area yang sinkron dengan count dan top reasons', () => {
        const querySpy = vi.spyOn(connectionPool, 'query');
        querySpy
            .mockReturnValueOnce([
                {
                    id: 10,
                    name: 'Area Dishub',
                    description: null,
                    rt: null,
                    rw: null,
                    kelurahan: 'Kedung',
                    kecamatan: 'Bojonegoro',
                    latitude: null,
                    longitude: null,
                },
            ])
            .mockReturnValueOnce([
                {
                    id: 1,
                    name: 'Cam Internal',
                    area_id: 10,
                    is_online: 1,
                    enable_recording: 1,
                    stream_source: 'internal',
                    delivery_type: 'internal_hls',
                    private_rtsp_url: 'rtsp://internal',
                    external_hls_url: null,
                    external_stream_url: null,
                    external_embed_url: null,
                    external_snapshot_url: null,
                },
                {
                    id: 2,
                    name: 'Cam External',
                    area_id: 10,
                    is_online: 0,
                    enable_recording: 0,
                    stream_source: 'external',
                    delivery_type: 'external_hls',
                    private_rtsp_url: null,
                    external_hls_url: 'https://example.com/index.m3u8',
                    external_stream_url: 'https://example.com/index.m3u8',
                    external_embed_url: null,
                    external_snapshot_url: null,
                },
                {
                    id: 3,
                    name: 'Cam Legacy',
                    area_id: 10,
                    is_online: 0,
                    enable_recording: 0,
                    stream_source: 'external',
                    delivery_type: 'internal_hls',
                    private_rtsp_url: null,
                    external_hls_url: null,
                    external_stream_url: null,
                    external_embed_url: null,
                    external_snapshot_url: null,
                },
            ]);
        vi.spyOn(cameraHealthService, 'getHealthDebugSnapshot').mockReturnValue([
            { cameraId: 2, lastReason: 'tls_verification_failed' },
            { cameraId: 3, lastReason: 'missing_external_source_metadata' },
        ]);

        const result = areaService.getAdminOverview();

        expect(result.isCached).toBe(false);
        expect(result.data).toEqual([
            expect.objectContaining({
                id: 10,
                name: 'Area Dishub',
                cameraCount: 3,
                onlineCount: 1,
                offlineCount: 2,
                internalValidCount: 1,
                externalValidCount: 1,
                externalUnresolvedCount: 1,
                recordingEnabledCount: 1,
                topReasons: [
                    { reason: 'tls_verification_failed', count: 1 },
                    { reason: 'missing_external_source_metadata', count: 1 },
                ],
            }),
        ]);
    });
});
