/**
 * Purpose: Verify stream response delivery routing and public viewer stats enrichment.
 * Caller: Backend focused test gate for streamService.
 * Deps: vitest, streamService, connectionPool and cameraViewStatsService mocks.
 * MainFuncs: streamService camera response tests.
 * SideEffects: Mocks database/stat service calls only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import streamService from '../services/streamService.js';

const { queryMock, queryOneMock, viewStatsMock } = vi.hoisted(() => ({
    queryMock: vi.fn(),
    queryOneMock: vi.fn(),
    viewStatsMock: vi.fn(),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: (...args) => queryMock(...args),
    queryOne: (...args) => queryOneMock(...args),
    execute: vi.fn(),
}));

vi.mock('../services/cameraViewStatsService.js', () => ({
    default: {
        getPublicStatsByCamera: viewStatsMock,
        emptyStats: {
            live_viewers: 0,
            total_views: 0,
            total_watch_seconds: 0,
            last_viewed_at: null,
        },
    },
}));

vi.mock('../services/cameraHealthService.js', () => ({
    default: {
        enrichCameraAvailability: (camera) => camera,
    },
}));

describe('streamService camera response routing', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryOneMock.mockReset();
        viewStatsMock.mockReset();
        viewStatsMock.mockReturnValue({});
    });

    it('routes external_hls streams.hls through the opaque /api/stream proxy when external_use_proxy is enabled (default)', () => {
        // G3 change: instead of putting the raw external URL into
        // streams.hls (which leaked it to the browser), the response
        // now carries the opaque per-camera proxy path. The raw URL
        // continues to be exposed on the response's external_*_url
        // fields for now — that field-level sanitization is G4.
        const response = streamService.buildCameraResponse({
            id: 11,
            stream_key: 'camera11',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
        });

        expect(response.delivery_type).toBe('external_hls');
        expect(response.streams).toEqual({
            hls: '/api/stream/11/external.m3u8',
            webrtc: null,
        });
    });

    it('falls back to the raw external URL in streams.hls when external_use_proxy is disabled', () => {
        const response = streamService.buildCameraResponse({
            id: 11,
            stream_key: 'camera11',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
            external_use_proxy: 0,
        });

        expect(response.delivery_type).toBe('external_hls');
        expect(response.streams).toEqual({
            hls: 'https://example.com/live/index.m3u8',
            webrtc: null,
        });
    });

    it('strips external_hls_url + external_stream_url from public response when proxy is enabled', () => {
        // G4: with proxy enabled (default), the upstream URL must NOT
        // ride along on the response. The opaque streams.hls path is
        // the only thing the client needs.
        const response = streamService.buildCameraResponse({
            id: 11,
            stream_key: 'camera11',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
            external_hls_url: 'https://example.com/live/index.m3u8',
        });

        expect(response.streams.hls).toBe('/api/stream/11/external.m3u8');
        expect(response.external_hls_url).toBeNull();
        expect(response.external_stream_url).toBeNull();
    });

    it('keeps external_hls_url + external_stream_url when proxy is disabled (direct-stream mode)', () => {
        // Admin opt-in: external_use_proxy=0 means "give the browser the
        // raw URL so it can stream directly". The raw fields must remain
        // populated for that flow to work.
        const response = streamService.buildCameraResponse({
            id: 12,
            stream_key: 'camera12',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
            external_hls_url: 'https://example.com/live/index.m3u8',
            external_use_proxy: 0,
        });

        expect(response.streams.hls).toBe('https://example.com/live/index.m3u8');
        expect(response.external_hls_url).toBe('https://example.com/live/index.m3u8');
        expect(response.external_stream_url).toBe('https://example.com/live/index.m3u8');
    });

    it('does not expose stream_key on the public response payload', () => {
        // F4: stream_key is still used internally to compose streams.hls
        // (/hls/{stream_key}/index.m3u8), but it must not be its own
        // separate field on the public response — that gives scrapers
        // a stable identifier without parsing the URL.
        const response = streamService.buildCameraResponse({
            id: 99,
            stream_key: 'abc-uuid-1234',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
        });

        expect(response).not.toHaveProperty('stream_key');
        // The URL is still constructed from the value, just not exposed
        // as its own field. Sanity: the streams.hls path uses it.
        expect(response.streams.hls).toContain('abc-uuid-1234');
    });

    it('does not affect external_embed_url / external_snapshot_url on proxied external_hls', () => {
        // Those fields belong to other delivery types (iframe embed,
        // separate snapshot). G4 only sanitizes the HLS-source fields.
        const response = streamService.buildCameraResponse({
            id: 13,
            stream_key: 'camera13',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
            external_embed_url: 'https://example.com/embed/13',
            external_snapshot_url: 'https://example.com/snap/13.jpg',
        });

        expect(response.delivery_type).toBe('external_hls');
        expect(response.external_hls_url).toBeNull();
        expect(response.external_embed_url).toBe('https://example.com/embed/13');
        expect(response.external_snapshot_url).toBe('https://example.com/snap/13.jpg');
    });

    it('never builds internal hls urls for non-hls external cameras', () => {
        const response = streamService.buildCameraResponse({
            id: 12,
            stream_key: 'camera12',
            stream_source: 'internal',
            external_stream_url: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
        });

        expect(response.delivery_type).toBe('external_mjpeg');
        expect(response.streams).toEqual({});
    });

    it('adds live and lifetime viewer stats to active stream cards without per-camera queries', () => {
        queryMock.mockReturnValue([
            {
                id: 1,
                name: 'Cam 1',
                stream_key: 'camera1',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
            },
            {
                id: 2,
                name: 'Cam 2',
                stream_key: 'camera2',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
            },
        ]);
        viewStatsMock.mockReturnValue({
            1: {
                live_viewers: 3,
                total_views: 12,
                total_watch_seconds: 90,
                last_viewed_at: '2026-05-05 12:30:00',
            },
        });

        const streams = streamService.getAllActiveStreams('cctv.raf.my.id');

        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(viewStatsMock).toHaveBeenCalledTimes(1);
        expect(streams[0].viewer_stats).toEqual({
            live_viewers: 3,
            total_views: 12,
            total_watch_seconds: 90,
            last_viewed_at: '2026-05-05 12:30:00',
        });
        expect(streams[1].viewer_stats).toEqual({
            live_viewers: 0,
            total_views: 0,
            total_watch_seconds: 0,
            last_viewed_at: null,
        });
    });

    it('does not expose private RTSP credentials in public stream responses', () => {
        const response = streamService.buildCameraResponse({
            id: 21,
            name: 'Private Cam',
            stream_key: 'camera21',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.5/live',
        });

        expect(response).not.toHaveProperty('private_rtsp_url');
        expect(JSON.stringify(response)).not.toContain('rtsp://admin:secret');
    });

    it('keeps internal RTSP available to backend stream health while sanitizing public getStreamUrls output', () => {
        queryOneMock.mockImplementation((sql) => {
            expect(sql).toContain('c.private_rtsp_url');
            return {
                id: 31,
                name: 'Local Cam',
                stream_key: 'camera31',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                enabled: 1,
                private_rtsp_url: 'rtsp://admin:secret@10.0.0.31/live',
            };
        });

        const response = streamService.getStreamUrls(31, 'localhost:3001');

        expect(response.streams.hls).toBe('/hls/camera31/index.m3u8');
        expect(JSON.stringify(response)).not.toContain('rtsp://admin:secret');
        expect(response.camera).not.toHaveProperty('private_rtsp_url');
    });
});
