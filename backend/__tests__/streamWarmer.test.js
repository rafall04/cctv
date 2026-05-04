/*
Purpose: Regression coverage for policy-aware internal stream prewarming.
Caller: Backend Vitest suite before changing stream warmer startup behavior.
Deps: streamWarmer service with mocked axios and fake timers.
MainFuncs: warmAllCameras policy filtering.
SideEffects: Uses fake timers; no network calls.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosGetMock = vi.fn();
const axiosHeadMock = vi.fn();

vi.mock('axios', () => ({
    default: {
        get: axiosGetMock,
        head: axiosHeadMock,
    },
}));

vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: {
            apiUrl: 'http://localhost:9997',
            hlsUrlInternal: 'http://localhost:8888',
        },
    },
}));

describe('streamWarmer policy filtering', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        axiosGetMock.mockResolvedValue({ data: { sourceReady: true } });
        axiosHeadMock.mockResolvedValue({});
    });

    afterEach(async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        streamWarmer.stopAll();
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('warms only cameras resolved as always_on', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        const waitSpy = vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        const summary = await streamWarmer.warmAllCameras([
            {
                id: 1,
                stream_key: 'local-key',
                private_rtsp_url: 'rtsp://local/stream',
                internal_ingest_policy_override: 'always_on',
                _areaPolicy: { internal_ingest_policy_default: 'default' },
            },
            {
                id: 2,
                stream_key: 'remote-key',
                private_rtsp_url: 'rtsp://remote/stream',
                internal_ingest_policy_override: 'default',
                _areaPolicy: { internal_ingest_policy_default: 'on_demand' },
            },
        ]);

        expect(summary).toEqual({
            total: 2,
            warmed: 1,
            skipped: 1,
        });
        expect(streamWarmer.getWarmedStreams()).toEqual(['local-key']);
        expect(axiosGetMock).toHaveBeenCalledWith(
            'http://localhost:9997/v3/paths/get/local-key',
            { timeout: 5000 }
        );
        expect(axiosGetMock).not.toHaveBeenCalledWith(
            'http://localhost:9997/v3/paths/get/remote-key',
            expect.anything()
        );

        waitSpy.mockRestore();
    });

    it('skips strict compatibility profiles unless explicitly overridden always_on', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        const summary = await streamWarmer.warmAllCameras([
            {
                id: 3,
                stream_key: 'surabaya-key',
                private_rtsp_url: 'rtsp://surabaya/stream',
                internal_ingest_policy_override: 'default',
                source_profile: 'surabaya_private_rtsp',
                enable_recording: 0,
                _areaPolicy: { internal_ingest_policy_default: 'default' },
            },
        ]);

        expect(summary.warmed).toBe(0);
        expect(summary.skipped).toBe(1);
        expect(streamWarmer.getWarmedStreams()).toEqual([]);
    });
});
