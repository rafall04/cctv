import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
    queryMock,
    queryOneMock,
    executeMock,
    transactionMock,
    invalidateCacheMock,
    updateCameraPathMock,
    removeCameraPathByKeyMock,
    logAdminActionMock,
    logCameraCreatedMock,
    logCameraUpdatedMock,
    logCameraDeletedMock,
} = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
    executeMock: vi.fn(),
    transactionMock: vi.fn((fn) => fn),
    invalidateCacheMock: vi.fn(),
    updateCameraPathMock: vi.fn(async () => ({ success: true })),
    removeCameraPathByKeyMock: vi.fn(async () => ({ success: true })),
    logAdminActionMock: vi.fn(),
    logCameraCreatedMock: vi.fn(),
    logCameraUpdatedMock: vi.fn(),
    logCameraDeletedMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
    transaction: transactionMock,
}));

vi.mock('../middleware/cacheMiddleware.js', () => ({
    invalidateCache: invalidateCacheMock,
}));

vi.mock('../services/mediaMtxService.js', () => ({
    default: {
        updateCameraPath: updateCameraPathMock,
        removeCameraPathByKey: removeCameraPathByKeyMock,
    },
}));

vi.mock('../services/securityAuditLogger.js', () => ({
    logAdminAction: logAdminActionMock,
    logCameraCreated: logCameraCreatedMock,
    logCameraUpdated: logCameraUpdatedMock,
    logCameraDeleted: logCameraDeletedMock,
}));

vi.mock('../services/thumbnailPathService.js', () => ({
    sanitizeCameraThumbnail: (camera) => camera,
    sanitizeCameraThumbnailList: (cameras) => cameras,
}));

import cameraService from '../services/cameraService.js';

describe('cameraService backup restore', () => {
    const existingArea = { id: 4, name: 'KEC BOJONEGORO DAN SEKITARNYA' };
    const unresolvedCamera = {
        id: 12,
        name: 'PEREMPATAN JEMBATAN SOSRODILOGO',
        area_id: 4,
        area_name: 'KEC BOJONEGORO DAN SEKITARNYA',
        stream_source: 'external',
        delivery_type: 'internal_hls',
        private_rtsp_url: '',
        external_hls_url: null,
        external_stream_url: null,
        external_embed_url: null,
        external_snapshot_url: null,
        external_origin_mode: 'direct',
        external_use_proxy: 1,
        external_tls_mode: 'strict',
        enabled: 1,
        stream_key: 'stream-12',
        enable_recording: 0,
    };

    beforeEach(() => {
        vi.clearAllMocks();

        queryMock.mockImplementation((sql) => {
            if (sql.includes('SELECT id, name FROM areas')) {
                return [existingArea];
            }
            if (sql.includes('FROM cameras c') && sql.includes('LEFT JOIN areas')) {
                return [unresolvedCamera];
            }
            return [];
        });

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('FROM cameras WHERE id = ?')) {
                return unresolvedCamera;
            }
            return null;
        });
    });

    it('matches unresolved camera by id and marks it repairable', () => {
        const result = cameraService.previewCameraRestore({
            backupFileName: 'cctv_backup_2026-03-24.json',
            backupItems: [{
                id: 12,
                name: 'PEREMPATAN JEMBATAN SOSRODILOGO',
                area_name: 'KEC BOJONEGORO DAN SEKITARNYA',
                stream_source: 'external',
                external_hls_url: 'https://data.bojonegorokab.go.id/live/local/05dfbeca-138c-4e12-a89a-c7b4f08375e7.m3u8',
                external_use_proxy: 1,
                external_tls_mode: 'strict',
            }],
            scope: { mode: 'unresolved_only' },
        });

        expect(result.canApply).toBe(true);
        expect(result.counts.matched_repairable).toBe(1);
        expect(result.rows[0]).toMatchObject({
            status: 'matched_repairable',
            matchReason: 'matched_by_id',
            targetCameraId: 12,
            backupDeliveryType: 'external_hls',
        });
        expect(result.rows[0].changedFields).toContain('external_hls_url');
        expect(result.rows[0].changedFields).toContain('external_stream_url');
    });

    it('applies restore and syncs external stream fields', async () => {
        const request = {
            user: { id: 1, username: 'admin' },
            ip: '127.0.0.1',
        };
        const updateCameraSpy = vi.spyOn(cameraService, 'updateCamera').mockResolvedValue(undefined);

        const result = await cameraService.applyCameraRestore({
            backupFileName: 'cctv_backup_2026-03-24.json',
            backupItems: [{
                id: 12,
                name: 'PEREMPATAN JEMBATAN SOSRODILOGO',
                area_name: 'KEC BOJONEGORO DAN SEKITARNYA',
                stream_source: 'external',
                external_hls_url: 'https://data.bojonegorokab.go.id/live/local/05dfbeca-138c-4e12-a89a-c7b4f08375e7.m3u8',
                external_use_proxy: 1,
                external_tls_mode: 'strict',
            }],
            scope: { mode: 'unresolved_only' },
        }, request);

        expect(updateCameraSpy).toHaveBeenCalledTimes(1);
        expect(updateCameraSpy).toHaveBeenCalledWith(
            12,
            expect.objectContaining({
                stream_source: 'external',
                delivery_type: 'external_hls',
                external_hls_url: 'https://data.bojonegorokab.go.id/live/local/05dfbeca-138c-4e12-a89a-c7b4f08375e7.m3u8',
                external_stream_url: 'https://data.bojonegorokab.go.id/live/local/05dfbeca-138c-4e12-a89a-c7b4f08375e7.m3u8',
            }),
            request,
        );
        expect(result.repaired).toBe(1);
        expect(executeMock).toHaveBeenCalled();
        updateCameraSpy.mockRestore();
    });
});
