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

        // Drain the fire-and-forget warmStream() microtask chains (initial triggerStream → HLS
        // muxer warm → interval registration) so warmer state is settled before we assert on it.
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }

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

        // The warmed always_on camera must have its HLS muxer touched (kept warm for fast TTFF
        // under hlsAlwaysRemux:no — a ready source alone is not a warm muxer).
        expect(axiosHeadMock).toHaveBeenCalledWith(
            'http://localhost:8888/local-key/index.m3u8',
            { timeout: 15000 }
        );
        // The on_demand camera is never warmed (no HLS touch → stays light).
        expect(axiosHeadMock).not.toHaveBeenCalledWith(
            'http://localhost:8888/remote-key/index.m3u8',
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

describe('streamWarmer reconcile (post-startup warm-set sync)', () => {
    const alwaysOn = (id, key) => ({
        id,
        stream_key: key,
        private_rtsp_url: `rtsp://cam/${id}`,
        internal_ingest_policy_override: 'always_on',
        _areaPolicy: { internal_ingest_policy_default: 'default' },
    });
    const onDemand = (id, key) => ({
        id,
        stream_key: key,
        private_rtsp_url: `rtsp://cam/${id}`,
        internal_ingest_policy_override: 'on_demand',
        _areaPolicy: { internal_ingest_policy_default: 'default' },
    });

    // Drain the fire-and-forget warmStream() microtask chains so warmer state settles before asserting.
    const drain = async () => {
        for (let i = 0; i < 10; i++) {
            await Promise.resolve();
        }
    };

    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        axiosGetMock.mockResolvedValue({ data: { sourceReady: true } });
        axiosHeadMock.mockResolvedValue({});
    });

    afterEach(async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        streamWarmer.stopAll();
        streamWarmer.setCameraProvider(null);
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('starts newly-eligible always_on cameras and ignores on_demand', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        const result = await streamWarmer.reconcile([alwaysOn(1, 'key-a'), onDemand(2, 'key-b')]);
        await drain();

        expect(result).toEqual({ desired: 1, started: 1, stopped: 0 });
        expect(streamWarmer.getWarmedStreams()).toEqual(['key-a']);
        // on_demand path must never be touched (stays light).
        expect(axiosHeadMock).not.toHaveBeenCalledWith(
            'http://localhost:8888/key-b/index.m3u8',
            expect.anything()
        );
    });

    it('stops paths no longer eligible — flipped to on_demand or deleted (the warm-interval leak fix)', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        await streamWarmer.reconcile([alwaysOn(1, 'key-a'), alwaysOn(2, 'key-b')]);
        await drain();
        expect(streamWarmer.getWarmedStreams().sort()).toEqual(['key-a', 'key-b']);

        // key-a flips to on_demand, key-b is deleted (absent from the list).
        const result = await streamWarmer.reconcile([onDemand(1, 'key-a')]);
        await drain();

        expect(result).toEqual({ desired: 0, started: 0, stopped: 2 });
        expect(streamWarmer.getWarmedStreams()).toEqual([]);
    });

    it('is a no-op when the desired set is unchanged', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();

        await streamWarmer.reconcile([alwaysOn(1, 'key-a')]);
        await drain();
        const result = await streamWarmer.reconcile([alwaysOn(1, 'key-a')]);
        await drain();

        expect(result).toEqual({ desired: 1, started: 0, stopped: 0 });
        expect(streamWarmer.getWarmedStreams()).toEqual(['key-a']);
    });

    it('scheduleReconcile is a no-op until a camera provider is wired', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');

        streamWarmer.scheduleReconcile(1500);
        await vi.advanceTimersByTimeAsync(2000);

        expect(streamWarmer.getWarmedStreams()).toEqual([]);
        expect(axiosGetMock).not.toHaveBeenCalled();
    });

    it('scheduleReconcile debounces a burst into a single provider-driven reconcile', async () => {
        const { default: streamWarmer } = await import('../services/streamWarmer.js');
        vi.spyOn(streamWarmer, 'waitBetweenWarmStarts').mockResolvedValue();
        const provider = vi.fn(() => [alwaysOn(1, 'key-a')]);
        streamWarmer.setCameraProvider(provider);

        // Three rapid mutations (e.g. a bulk edit) must coalesce.
        streamWarmer.scheduleReconcile(1500);
        streamWarmer.scheduleReconcile(1500);
        streamWarmer.scheduleReconcile(1500);
        await vi.advanceTimersByTimeAsync(1500);
        await drain();

        expect(provider).toHaveBeenCalledTimes(1);
        expect(streamWarmer.getWarmedStreams()).toEqual(['key-a']);
    });
});
