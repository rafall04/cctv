import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as connectionPool from '../database/connectionPool.js';
import cameraHealthService from '../services/cameraHealthService.js';
import areaService from '../services/areaService.js';

describe('areaService.getAllAreas — public surface must not leak private areas', () => {
    beforeEach(() => areaService.invalidateAreaCache());
    afterEach(() => { vi.restoreAllMocks(); areaService.invalidateAreaCache(); });

    it('scopes the PUBLIC list to areas that actually hold a public camera (EXISTS + community)', () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([]);
        areaService.getAllAreas({ publicOnly: true });
        const sql = querySpy.mock.calls[0][0];
        // The area ROW is withheld unless a public camera exists — otherwise a private area (all
        // owner_private/subscriber-suspended cameras) leaks its name/coords into the landing list.
        expect(sql).toContain('WHERE EXISTS');
        expect(sql).toContain("camera_class = 'community'");
    });

    it('does NOT scope the ADMIN list — admins still see every area', () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([]);
        areaService.getAllAreas();
        const sql = querySpy.mock.calls[0][0];
        expect(sql).not.toContain('WHERE EXISTS');
    });

    it('scopes the PUBLIC filter dropdowns to areas with a public camera', () => {
        const querySpy = vi.spyOn(connectionPool, 'query').mockReturnValue([]);
        areaService.getAreaFilters();
        // Every DISTINCT division query must gate on an existing public camera.
        for (const [sql] of querySpy.mock.calls) {
            expect(sql).toContain('EXISTS (SELECT 1 FROM cameras c WHERE c.area_id = areas.id');
            expect(sql).toContain("camera_class = 'community'");
        }
    });
});

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
                    coverage_scope: 'kecamatan',
                    viewport_zoom_override: 12,
                    show_on_grid_default: 0,
                    grid_default_camera_limit: 15,
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
                coverage_scope: 'kecamatan',
                viewport_zoom_override: 12,
                show_on_grid_default: 0,
                grid_default_camera_limit: 15,
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
