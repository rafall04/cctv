import { describe, expect, it } from 'vitest';
import streamService from '../services/streamService.js';

describe('streamService camera response routing', () => {
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
});
