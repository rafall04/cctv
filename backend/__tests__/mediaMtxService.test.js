/*
Purpose: Regression coverage for MediaMTX path synchronization and database camera reads.
Caller: Vitest backend suite.
Deps: Mocked axios MediaMTX API client, config, and connectionPool query helpers.
MainFuncs: mediaMtxService.updateCameraPath(), mediaMtxService.getDatabaseCameras().
SideEffects: No real MediaMTX or database calls; all external dependencies are mocked.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('axios', () => ({
    default: {
        create: () => ({
            get: getMock,
            post: postMock,
            patch: patchMock,
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
                sourceProtocol: 'tcp',
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
            sourceOnDemand: true,
            sourceOnDemandCloseAfter: '30s',
        }));
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
                area_internal_ingest_policy_default: 'on_demand',
                area_internal_on_demand_close_after_seconds: 45,
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
        });
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
            sourceProtocol: 'tcp',
            sourceOnDemand: false,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '30s',
        });
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
            sourceProtocol: 'tcp',
            sourceOnDemand: true,
            sourceOnDemandStartTimeout: '10s',
            sourceOnDemandCloseAfter: '45s',
        });
    });
});
