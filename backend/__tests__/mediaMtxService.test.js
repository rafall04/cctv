/*
Purpose: Regression coverage for MediaMTX path synchronization and database camera reads.
Caller: Vitest backend suite.
Deps: Mocked axios MediaMTX API client, config, and connectionPool query helpers.
MainFuncs: mediaMtxService.updateCameraPath(), mediaMtxService.getDatabaseCameras(), mediaMtxService.syncAreaCameras().
SideEffects: No real MediaMTX or database calls; all external dependencies are mocked.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: getMock,
            post: postMock,
            patch: patchMock,
            delete: deleteMock,
        }),
    },
}));

vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: {
            apiUrl: 'http://localhost:9997',
        },
    },
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('mediaMtxService on-demand path sync', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        getMock.mockReset();
        postMock.mockReset();
        patchMock.mockReset();
        deleteMock.mockReset();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('updates existing path when on-demand settings drift even if source matches', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        getMock.mockResolvedValueOnce({ data: { items: [{ name: 'stream-1' }] } });
        getMock.mockResolvedValueOnce({
            data: {
                name: 'stream-1',
                source: 'rtsp://admin:pass@36.66.208.98:554/live',
                rtspTransport: 'tcp',
                sourceOnDemand: false,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '0s',
            },
        });

        const result = await mediaMtxService.updateCameraPath(
            'stream-1',
            'rtsp://admin:pass@36.66.208.98:554/live',
            {
                internal_ingest_policy_override: 'on_demand',
                internal_on_demand_close_after_seconds_override: 30,
            }
        );

        expect(result).toEqual({ success: true, action: 'updated' });
        expect(patchMock).toHaveBeenCalledWith('/config/paths/patch/stream-1', expect.objectContaining({
            rtspTransport: 'tcp',
            sourceOnDemand: true,
            sourceOnDemandCloseAfter: '30s',
        }));
        expect(patchMock.mock.calls[0][1]).not.toHaveProperty('sourceProtocol');
    });

    it('qualifies joined camera columns when reading database cameras', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        queryMock.mockReturnValue([
            {
                id: 2,
                name: 'Internal Camera',
                rtsp_url: 'rtsp://admin:secret@192.168.14.2:554/stream1',
                stream_key: null,
                internal_ingest_policy_override: 'default',
                internal_on_demand_close_after_seconds_override: null,
                source_profile: null,
                description: null,
                enable_recording: 1,
                area_id: 9,
                area_internal_ingest_policy_default: 'on_demand',
                area_internal_on_demand_close_after_seconds: 45,
                area_internal_rtsp_transport_default: 'udp',
                path_name: 'camera2',
            },
        ]);

        const cameras = mediaMtxService.getDatabaseCameras();
        const sql = queryMock.mock.calls[0][0];

        expect(sql).toContain('cameras.id');
        expect(sql).toContain('COALESCE(cameras.stream_key');
        expect(sql).toContain("'camera' || cameras.id");
        expect(sql).toContain('WHERE cameras.enabled = 1');
        expect(cameras[0]._areaPolicy).toEqual({
            internal_ingest_policy_default: 'on_demand',
            internal_on_demand_close_after_seconds: 45,
            internal_rtsp_transport_default: 'udp',
        });
    });

    it('syncs only MediaMTX paths for the changed area', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        queryMock.mockReturnValue([
            {
                id: 2,
                area_id: 9,
                rtsp_url: 'rtsp://admin:secret@192.168.14.2:554/stream1',
                stream_key: null,
                internal_ingest_policy_override: 'default',
                internal_on_demand_close_after_seconds_override: null,
                internal_rtsp_transport_override: 'default',
                area_internal_ingest_policy_default: 'default',
                area_internal_on_demand_close_after_seconds: null,
                area_internal_rtsp_transport_default: 'udp',
                path_name: 'camera2',
            },
            {
                id: 3,
                area_id: 10,
                rtsp_url: 'rtsp://admin:secret@192.168.14.3:554/stream1',
                stream_key: null,
                internal_ingest_policy_override: 'default',
                internal_on_demand_close_after_seconds_override: null,
                internal_rtsp_transport_override: 'default',
                area_internal_ingest_policy_default: 'default',
                area_internal_on_demand_close_after_seconds: null,
                area_internal_rtsp_transport_default: 'tcp',
                path_name: 'camera3',
            },
        ]);
        getMock.mockResolvedValueOnce({ data: { items: [{ name: 'camera2' }] } });

        const result = await mediaMtxService.syncAreaCameras(9);

        expect(result).toEqual({ updated: 1 });
        expect(patchMock).toHaveBeenCalledWith('/config/paths/patch/camera2', expect.objectContaining({
            rtspTransport: 'udp',
        }));
        expect(patchMock).toHaveBeenCalledTimes(1);
    });

    it('builds always-on MediaMTX path config for local cameras', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://local-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: null,
            description: '',
            enable_recording: 1,
            _areaPolicy: {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: null,
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://local-camera/stream',
            rtspTransport: 'tcp',
            sourceOnDemand: false,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '30s',
        });
        expect(pathConfig).not.toHaveProperty('sourceProtocol');
    });

    it('builds on-demand MediaMTX path config from area policy', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://remote-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            source_profile: null,
            description: '',
            enable_recording: 0,
            _areaPolicy: {
                internal_ingest_policy_default: 'on_demand',
                internal_on_demand_close_after_seconds: 45,
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://remote-camera/stream',
            rtspTransport: 'tcp',
            sourceOnDemand: true,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '45s',
        });
    });

    it('builds UDP MediaMTX path config from RTSP transport override', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://udp-only-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            internal_rtsp_transport_override: 'udp',
            source_profile: null,
            description: '',
            enable_recording: 0,
            _areaPolicy: {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: null,
                internal_rtsp_transport_default: 'default',
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://udp-only-camera/stream',
            rtspTransport: 'udp',
        });
    });

    it('builds automatic MediaMTX source protocol from area transport default', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        const pathConfig = mediaMtxService.buildInternalPathConfig({
            rtsp_url: 'rtsp://auto-camera/stream',
            internal_ingest_policy_override: 'default',
            internal_on_demand_close_after_seconds_override: null,
            internal_rtsp_transport_override: 'default',
            source_profile: null,
            description: '',
            enable_recording: 0,
            _areaPolicy: {
                internal_ingest_policy_default: 'default',
                internal_on_demand_close_after_seconds: null,
                internal_rtsp_transport_default: 'auto',
            },
        });

        expect(pathConfig).toMatchObject({
            source: 'rtsp://auto-camera/stream',
            rtspTransport: 'automatic',
        });
    });

    it('treats legacy sourceProtocol configs as equivalent when checking path drift', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        expect(mediaMtxService.pathConfigNeedsUpdate(
            {
                source: 'rtsp://legacy-camera/stream',
                sourceProtocol: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            },
            {
                source: 'rtsp://legacy-camera/stream',
                rtspTransport: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            }
        )).toBe(false);
    });

    it('falls back to legacy sourceProtocol payload only when MediaMTX rejects modern rtspTransport', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');
        const badRequest = new Error('Request failed with status code 400');
        badRequest.response = { status: 400 };

        getMock.mockResolvedValueOnce({ data: { items: [{ name: 'stream-legacy' }] } });
        getMock.mockResolvedValueOnce({
            data: {
                name: 'stream-legacy',
                source: 'rtsp://admin:pass@10.0.0.10/live',
                sourceProtocol: 'udp',
                sourceOnDemand: false,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            },
        });
        patchMock
            .mockRejectedValueOnce(badRequest)
            .mockResolvedValueOnce({});

        const result = await mediaMtxService.updateCameraPath(
            'stream-legacy',
            'rtsp://admin:pass@10.0.0.10/live',
            {
                internal_rtsp_transport_override: 'tcp',
            }
        );

        expect(result).toEqual({ success: true, action: 'updated' });
        expect(patchMock.mock.calls[0][1]).toMatchObject({ rtspTransport: 'tcp' });
        expect(patchMock.mock.calls[0][1]).not.toHaveProperty('sourceProtocol');
        expect(patchMock.mock.calls[1][1]).toMatchObject({ sourceProtocol: 'tcp' });
        expect(patchMock.mock.calls[1][1]).not.toHaveProperty('rtspTransport');
    });

    it('refreshes an existing path after camera source changes', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        getMock.mockResolvedValueOnce({
            data: {
                name: 'stream-refresh',
                source: 'rtsp://admin:pass@10.0.0.10/live',
                rtspTransport: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            },
        });
        patchMock.mockResolvedValueOnce({});
        deleteMock.mockResolvedValueOnce({});
        postMock.mockResolvedValueOnce({});

        const result = await mediaMtxService.refreshCameraPathAfterSourceChange(
            'stream-refresh',
            'rtsp://admin:pass@10.0.0.20/live',
            {
                internal_ingest_policy_override: 'on_demand',
                internal_on_demand_close_after_seconds_override: 30,
                internal_rtsp_transport_override: 'default',
            }
        );

        expect(result).toEqual({
            success: true,
            action: 'refreshed',
            pathName: 'stream-refresh',
        });
        expect(patchMock).toHaveBeenCalledWith('/config/paths/patch/stream-refresh', expect.objectContaining({
            source: 'rtsp://admin:pass@10.0.0.20/live',
            rtspTransport: 'tcp',
        }));
        expect(deleteMock).toHaveBeenCalledWith('/config/paths/delete/stream-refresh');
        expect(postMock).toHaveBeenCalledWith('/config/paths/add/stream-refresh', expect.objectContaining({
            source: 'rtsp://admin:pass@10.0.0.20/live',
        }));
    });

    it('creates path when refreshing a camera source with no existing config', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        getMock.mockRejectedValueOnce(Object.assign(new Error('not found'), {
            response: { status: 404 },
        }));
        postMock.mockResolvedValueOnce({});

        const result = await mediaMtxService.refreshCameraPathAfterSourceChange(
            'stream-new',
            'rtsp://admin:pass@10.0.0.30/live',
            {
                internal_ingest_policy_override: 'default',
                internal_on_demand_close_after_seconds_override: null,
                internal_rtsp_transport_override: 'udp',
            }
        );

        expect(result).toEqual({
            success: true,
            action: 'created',
            pathName: 'stream-new',
        });
        expect(postMock).toHaveBeenCalledWith('/config/paths/add/stream-new', expect.objectContaining({
            source: 'rtsp://admin:pass@10.0.0.30/live',
            rtspTransport: 'udp',
        }));
        expect(deleteMock).not.toHaveBeenCalled();
    });

    it('keeps patched config and skips add when path delete fails during refresh', async () => {
        const { default: mediaMtxService } = await import('../services/mediaMtxService.js');

        getMock.mockResolvedValueOnce({
            data: {
                name: 'stream-delete-fails',
                source: 'rtsp://admin:pass@10.0.0.10/live',
                rtspTransport: 'tcp',
                sourceOnDemand: true,
                sourceOnDemandStartTimeout: '10s',
                sourceOnDemandCloseAfter: '30s',
            },
        });
        patchMock.mockResolvedValueOnce({});
        deleteMock.mockRejectedValueOnce(new Error('delete failed'));

        const result = await mediaMtxService.refreshCameraPathAfterSourceChange(
            'stream-delete-fails',
            'rtsp://admin:pass@10.0.0.40/live',
            {
                internal_ingest_policy_override: 'on_demand',
                internal_on_demand_close_after_seconds_override: 30,
                internal_rtsp_transport_override: 'default',
            }
        );

        expect(result).toEqual({
            success: true,
            action: 'patched_refresh_pending',
            pathName: 'stream-delete-fails',
            error: 'delete failed',
        });
        expect(patchMock).toHaveBeenCalledTimes(1);
        expect(deleteMock).toHaveBeenCalledWith('/config/paths/delete/stream-delete-fails');
        expect(postMock).not.toHaveBeenCalled();
    });
});
