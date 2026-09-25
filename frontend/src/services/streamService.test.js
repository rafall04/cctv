/*
Purpose: Verify getStreamUrls — the on-demand provider warm-up (Gresik /start + playlist poll) and that the provider control URL never reaches the player.
Caller: Vitest frontend suite.
Deps: vitest; apiClient + global fetch mocked.
MainFuncs: streamService.getStreamUrls external_hls direct/proxied branches.
SideEffects: None — network fully stubbed.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { streamService } from './streamService';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('./apiClient', () => ({ default: { get } }));

const GRESIK_CAM = {
    id: 584,
    delivery_type: 'external_hls',
    stream_source: 'external',
    external_use_proxy: 0,
    external_hls_url: 'https://cctvkanjeng.gresikkab.go.id/hls/legundi-4/index.m3u8',
    streams: {
        hls: 'https://cctvkanjeng.gresikkab.go.id/hls/legundi-4/index.m3u8',
        webrtc: null,
        external_start_url: 'https://cctvkanjeng.gresikkab.go.id/api/v1/public/cctv/584/start',
    },
};

describe('streamService.getStreamUrls — on-demand provider warm-up', () => {
    beforeEach(() => {
        get.mockReset();
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => vi.unstubAllGlobals());

    it('POSTs the provider start endpoint then polls the playlist until it is live', async () => {
        get.mockResolvedValue({ data: { success: true, data: GRESIK_CAM } });
        fetch
            .mockResolvedValueOnce({ ok: true })                          // POST /start
            .mockResolvedValueOnce({ ok: false, status: 404 })            // playlist not ready yet
            .mockResolvedValueOnce({ ok: true, status: 200 });            // playlist live

        const res = await streamService.getStreamUrls(584);

        expect(fetch).toHaveBeenCalledTimes(3);
        expect(fetch.mock.calls[0][0]).toContain('/api/v1/public/cctv/584/start');
        expect(fetch.mock.calls[0][0]).toContain('viewer_id=');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
        // playlist polls hit the raw external m3u8 directly
        expect(fetch.mock.calls[1][0]).toBe(GRESIK_CAM.streams.hls);
        expect(res.data.streams.hls).toBe(GRESIK_CAM.streams.hls);
        // the provider control URL is consumed, not handed to the player
        expect(res.data.streams.external_start_url).toBeUndefined();
    });

    it('does not warm up when the camera has no external_start_url', async () => {
        get.mockResolvedValue({
            data: {
                success: true,
                data: {
                    ...GRESIK_CAM,
                    streams: { hls: GRESIK_CAM.streams.hls, webrtc: null },
                },
            },
        });
        await streamService.getStreamUrls(584);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('does not warm up proxied external cameras (server handles them)', async () => {
        get.mockResolvedValue({
            data: {
                success: true,
                data: { ...GRESIK_CAM, external_use_proxy: 1 },
            },
        });
        const res = await streamService.getStreamUrls(584);
        expect(fetch).not.toHaveBeenCalled();
        expect(res.data.streams.hls).toContain('/hls/proxy?');
    });

    it('still returns the stream when the provider never comes up (player error path decides)', async () => {
        get.mockResolvedValue({ data: { success: true, data: GRESIK_CAM } });
        fetch.mockResolvedValue({ ok: false, status: 404 });
        const res = await streamService.getStreamUrls(584);
        expect(res.data.streams.hls).toBe(GRESIK_CAM.streams.hls);
    }, 30000);
});
