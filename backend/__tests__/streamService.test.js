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

    it('keeps dirty legacy external URLs on the external_hls path', () => {
        const response = streamService.buildCameraResponse({
            id: 11,
            stream_key: 'camera11',
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8',
        });

        expect(response.delivery_type).toBe('external_hls');
        expect(response.streams).toEqual({
            hls: 'https://example.com/live/index.m3u8',
            webrtc: null,
        });
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
