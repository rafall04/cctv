import { describe, expect, it } from 'vitest';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';

describe('cameraDelivery compat inference', () => {
    it('maps legacy external_hls_url cameras to external_hls', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_hls_url: 'https://example.com/live/index.m3u8',
        })).toBe('external_hls');
    });

    it('maps external_stream_url m3u8 cameras to external_hls', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'https://example.com/live/index.m3u8?token=abc',
        })).toBe('external_hls');
    });

    it('maps ZoneMinder MJPEG cameras to external_mjpeg', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
        })).toBe('external_mjpeg');
    });

    it('maps jsmpeg websocket cameras to external_jsmpeg', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'wss://cctv.villabs.id/streamer-jsmpeg/streamer/gading1',
        })).toBe('external_jsmpeg');
    });

    it('maps generic websocket cameras to external_custom_ws', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'wss://dishubstreaming.mojokertokab.go.id/rtsp/uuid',
        })).toBe('external_custom_ws');
    });

    it('keeps bare legacy external cameras on the external_hls compat path', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
        })).toBe('external_hls');
    });

    it('prefers external_stream_url as the primary external URL', () => {
        expect(getPrimaryExternalStreamUrl({
            stream_source: 'external',
            external_hls_url: 'https://example.com/old/index.m3u8',
            external_stream_url: 'https://example.com/new/index.m3u8',
        })).toBe('https://example.com/new/index.m3u8');
    });
});
