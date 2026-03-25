import { describe, expect, it } from 'vitest';
import {
    buildCameraPayload,
    defaultCameraFormValues,
    getCameraValidationRules,
    mapCameraToFormValues,
} from './cameraFormAdapter';

describe('cameraFormAdapter delivery type support', () => {
    it('maps legacy external HLS cameras into delivery-aware form values safely', () => {
        const values = mapCameraToFormValues({
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_use_proxy: 1,
            external_tls_mode: 'insecure',
        });

        expect(values.delivery_type).toBe('external_hls');
        expect(values.external_stream_url).toBe('https://example.com/live.m3u8');
        expect(values.external_use_proxy).toBe(true);
        expect(values.external_tls_mode).toBe('insecure');
    });

    it('builds external HLS payload with compat fields and strict proxy defaults', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'External Cam',
            delivery_type: 'external_hls',
            stream_source: 'external',
            external_stream_url: 'https://example.com/live.m3u8',
        });

        expect(payload).toMatchObject({
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.com/live.m3u8',
            external_stream_url: 'https://example.com/live.m3u8',
            private_rtsp_url: null,
            external_use_proxy: 1,
            external_tls_mode: 'strict',
        });
    });

    it('builds external MJPEG payload without playback recording fields', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'MJPEG Cam',
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            enable_recording: true,
            external_stream_url: 'https://example.com/zm/cgi-bin/nph-zms',
            external_snapshot_url: 'https://example.com/snapshot.jpg',
        });

        expect(payload).toMatchObject({
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            enable_recording: 0,
            external_stream_url: 'https://example.com/zm/cgi-bin/nph-zms',
            external_snapshot_url: 'https://example.com/snapshot.jpg',
            external_hls_url: null,
        });
    });

    it('validates WebSocket delivery types with ws/wss URLs only', () => {
        const rules = getCameraValidationRules('external_custom_ws');

        expect(rules.external_stream_url.custom('https://example.com/live')).toBe('URL must start with ws:// or wss://');
        expect(rules.external_stream_url.custom('wss://example.com/live')).toBeUndefined();
    });
});
