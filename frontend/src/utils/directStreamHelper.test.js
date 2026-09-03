/*
 * Purpose: Pin resolveStreamUrl — especially `isAnnotated`, the signal that a stream is the
 *          vehicle-count annotated feed (nginx-static, untracked by the backend) so the FRONTEND
 *          owns its viewer session. The flag rides inside camera.streams.annotated.
 * Caller: Vitest frontend suite.
 */
import { describe, expect, it } from 'vitest';
import { resolveStreamUrl } from './directStreamHelper';

describe('resolveStreamUrl — isAnnotated', () => {
    it('is false for a normal proxied HLS camera', () => {
        const r = resolveStreamUrl({ id: 11, streams: { hls: '/api/stream/11/external.m3u8' } });
        expect(r.isAnnotated).toBe(false);
        expect(r.isDirectStream).toBe(false);
    });

    it('is true for the annotated feed (proxied/internal branch)', () => {
        const r = resolveStreamUrl({
            id: 15,
            streams: { hls: '/hls/hitung/15/live.m3u8', annotated: true },
        });
        expect(r.isAnnotated).toBe(true);
        expect(r.isDirectStream).toBe(false);
        expect(r.targetUrl).toBe('/hls/hitung/15/live.m3u8');
    });

    it('carries isAnnotated through the DIRECT-stream branch too', () => {
        const r = resolveStreamUrl({
            id: 20,
            delivery_type: 'external_hls',
            external_use_proxy: 0,
            external_stream_url: 'https://up.example/live.m3u8',
            streams: { hls: 'https://up.example/live.m3u8', annotated: true },
        });
        expect(r.isDirectStream).toBe(true);
        expect(r.isAnnotated).toBe(true);
    });

    it('is false (never undefined) for a null camera', () => {
        expect(resolveStreamUrl(null).isAnnotated).toBe(false);
    });
});
