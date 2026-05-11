import { describe, expect, it } from 'vitest';
import {
    getEffectiveDeliveryType,
    getMultiViewRenderMode,
    getPrimaryExternalUrl,
    getStreamCapabilities,
    isMultiViewSupported,
} from './cameraDelivery.js';

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

    it('maps dirty legacy rows with external URLs to external_hls even when stream_source is wrong', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'internal',
            external_stream_url: 'https://example.com/live/index.m3u8?token=abc',
        })).toBe('external_hls');
    });

    it('maps ZoneMinder MJPEG cameras to external_mjpeg', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
        })).toBe('external_mjpeg');
    });

    it('maps direct flv cameras to external_flv', () => {
        expect(getEffectiveDeliveryType({
            stream_source: 'external',
            external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
        })).toBe('external_flv');
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

    it('marks external hls cameras as playback-capable for recorded playback', () => {
        expect(getStreamCapabilities({
            stream_source: 'external',
            external_stream_url: 'https://example.com/live/index.m3u8?token=abc',
        }).playback).toBe(true);
    });

    it('prefers the explicit external stream URL before legacy compat fields', () => {
        expect(getPrimaryExternalUrl({
            external_stream_url: 'https://example.com/new/index.m3u8',
            external_embed_url: 'https://example.com/embed',
            external_hls_url: 'https://example.com/old/index.m3u8',
        })).toBe('https://example.com/new/index.m3u8');
    });

    it('treats flv cameras as browser live-only sources with multi-view support', () => {
        expect(getStreamCapabilities({
            external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
            external_embed_url: 'https://example.com/flv-player#https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
        })).toEqual(expect.objectContaining({
            live: true,
            popup: true,
            multiview: true,
            playback: false,
            supported_player: 'flv',
        }));
    });

    it.each([
        ['internal_hls', 'hls'],
        ['external_hls', 'hls'],
        ['external_flv', 'flv'],
        ['external_mjpeg', 'mjpeg'],
        ['external_embed', 'embed'],
        ['external_jsmpeg', 'embed'],
    ])('supports %s in multi-view as %s', (deliveryType, expectedMode) => {
        const camera = {
            delivery_type: deliveryType,
            external_stream_url: deliveryType === 'external_mjpeg' ? 'https://example.com/mjpeg' : undefined,
            external_embed_url: deliveryType === 'external_embed' || deliveryType === 'external_jsmpeg'
                ? 'https://example.com/embed'
                : undefined,
        };

        expect(isMultiViewSupported(camera)).toBe(true);
        expect(getMultiViewRenderMode(camera)).toBe(expectedMode);
    });

    it('does not claim unsupported custom websocket URLs are playable without an embed fallback', () => {
        const camera = {
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/live',
        };

        expect(isMultiViewSupported(camera)).toBe(false);
        expect(getMultiViewRenderMode(camera)).toBe('unsupported');
    });

    it('supports custom websocket cameras when an embed fallback exists', () => {
        const camera = {
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/live',
            external_embed_url: 'https://example.com/player',
        };

        expect(isMultiViewSupported(camera)).toBe(true);
        expect(getMultiViewRenderMode(camera)).toBe('embed');
    });
});
