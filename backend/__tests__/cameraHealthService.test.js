import { describe, it, expect } from 'vitest';
import { CameraHealthService, parsePlaylist } from '../services/cameraHealthService.js';

describe('cameraHealthService.parsePlaylist', () => {
    it('parses master playlist and detects variants', () => {
        const input = [
            '#EXTM3U',
            '#EXT-X-VERSION:3',
            '#EXT-X-STREAM-INF:BANDWIDTH=1280000',
            'low/index.m3u8'
        ].join('\n');

        const result = parsePlaylist(input);

        expect(result.ok).toBe(true);
        expect(result.isMaster).toBe(true);
        expect(result.entries).toEqual(['low/index.m3u8']);
    });

    it('parses media playlist and extracts media sequence', () => {
        const input = [
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:2',
            '#EXT-X-MEDIA-SEQUENCE:42',
            '#EXTINF:2.0,',
            'seg42.ts'
        ].join('\n');

        const result = parsePlaylist(input);

        expect(result.ok).toBe(true);
        expect(result.isMaster).toBe(false);
        expect(result.mediaSequence).toBe(42);
        expect(result.entries).toContain('seg42.ts');
    });

    it('accepts playlist with UTF-8 BOM marker', () => {
        const input = '\uFEFF#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2.0,\nseg1.ts';
        const result = parsePlaylist(input);

        expect(result.ok).toBe(true);
        expect(result.isMaster).toBe(false);
    });

    it('returns invalid for non-M3U8 text', () => {
        const result = parsePlaylist('not a playlist');

        expect(result.ok).toBe(false);
        expect(result.reason).toBe('invalid_m3u8');
    });
});

describe('cameraHealthService hysteresis', () => {
    it('switches offline after 3 consecutive failures', () => {
        const service = new CameraHealthService();
        const camera = { id: 1, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyHysteresis(camera, { online: false, reason: 'timeout' })).toBe(1);
        expect(service.applyHysteresis(camera, { online: false, reason: 'timeout' })).toBe(1);
        expect(service.applyHysteresis(camera, { online: false, reason: 'timeout' })).toBe(0);
    });

    it('switches online after 2 consecutive successes', () => {
        const service = new CameraHealthService();
        const camera = { id: 2, is_online: 0 };

        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyHysteresis(camera, { online: true, reason: 'ok' })).toBe(0);
        expect(service.applyHysteresis(camera, { online: true, reason: 'ok' })).toBe(1);
    });
});
