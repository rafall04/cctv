import { describe, expect, it } from 'vitest';
import {
    buildCameraPayload,
    defaultCameraFormValues,
    mapCameraToFormValues,
} from './cameraFormAdapter';

describe('cameraFormAdapter external proxy controls', () => {
    it('maps external proxy controls into form values safely', () => {
        const values = mapCameraToFormValues({
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_use_proxy: 1,
            external_tls_mode: 'insecure',
        });

        expect(values.external_use_proxy).toBe(true);
        expect(values.external_tls_mode).toBe('insecure');
    });

    it('builds external camera payload with strict proxy defaults', () => {
        const payload = buildCameraPayload({
            ...defaultCameraFormValues,
            name: 'External Cam',
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
        });

        expect(payload).toMatchObject({
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            private_rtsp_url: null,
            external_use_proxy: 1,
            external_tls_mode: 'strict',
        });
    });
});
