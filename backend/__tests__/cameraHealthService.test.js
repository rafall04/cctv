import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const {
    handleCameraBecameOnlineMock,
    handleCameraBecameOfflineMock,
    refreshCameraThumbnailMock,
} = vi.hoisted(() => ({
    handleCameraBecameOnlineMock: vi.fn(),
    handleCameraBecameOfflineMock: vi.fn(),
    refreshCameraThumbnailMock: vi.fn(),
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        handleCameraBecameOnline: handleCameraBecameOnlineMock,
        handleCameraBecameOffline: handleCameraBecameOfflineMock,
    },
}));

vi.mock('../services/thumbnailService.js', () => ({
    default: {
        refreshCameraThumbnail: refreshCameraThumbnailMock,
    },
}));

import {
    CameraHealthService,
    buildExternalRequestOptions,
    mapExternalFetchError,
    normalizeExternalTlsMode,
    parsePlaylist
} from '../services/cameraHealthService.js';

vi.mock('axios', () => ({
    default: {
        get: vi.fn()
    }
}));

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

describe('cameraHealthService external TLS policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('normalizes invalid TLS mode to strict', () => {
        expect(normalizeExternalTlsMode('insecure')).toBe('insecure');
        expect(normalizeExternalTlsMode('strict')).toBe('strict');
        expect(normalizeExternalTlsMode('invalid')).toBe('strict');
        expect(normalizeExternalTlsMode(undefined)).toBe('strict');
    });

    it('maps TLS verification errors to a stable reason', () => {
        expect(mapExternalFetchError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe('tls_verification_failed');
        expect(mapExternalFetchError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })).toBe('tls_verification_failed');
        expect(mapExternalFetchError({ code: 'ECONNABORTED' })).toBe('ECONNABORTED');
    });

    it('builds an insecure HTTPS agent only for insecure mode', () => {
        const strictOptions = buildExternalRequestOptions('strict');
        const insecureOptions = buildExternalRequestOptions('insecure');

        expect(strictOptions.externalTlsMode).toBe('strict');
        expect(strictOptions.httpsAgent).toBeUndefined();
        expect(insecureOptions.externalTlsMode).toBe('insecure');
        expect(insecureOptions.httpsAgent).toBeTruthy();
    });

    it('keeps strict TLS for strict external camera checks', async () => {
        axios.get.mockResolvedValueOnce({
            status: 200,
            data: '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2.0,\nseg1.ts'
        });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 10,
            is_online: 1,
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_tls_mode: 'strict'
        }, new Map());

        expect(result.online).toBe(true);
        expect(axios.get).toHaveBeenCalledWith(
            'https://example.com/live.m3u8',
            expect.objectContaining({
                httpsAgent: undefined
            })
        );
    });

    it('uses insecure HTTPS agent for insecure external camera checks', async () => {
        axios.get.mockResolvedValueOnce({
            status: 200,
            data: '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2.0,\nseg1.ts'
        });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 11,
            is_online: 1,
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_tls_mode: 'insecure'
        }, new Map());

        expect(result.online).toBe(true);
        expect(axios.get).toHaveBeenCalledWith(
            'https://example.com/live.m3u8',
            expect.objectContaining({
                httpsAgent: expect.any(Object)
            })
        );
    });

    it('keeps TLS policy consistent from master to media playlist', async () => {
        axios.get
            .mockResolvedValueOnce({
                status: 200,
                data: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1280000\nvariant/index.m3u8'
            })
            .mockResolvedValueOnce({
                status: 200,
                data: '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:2\n#EXTINF:2.0,\nseg2.ts'
            });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 12,
            is_online: 1,
            stream_source: 'external',
            external_hls_url: 'https://example.com/master.m3u8',
            external_tls_mode: 'insecure'
        }, new Map());

        expect(result.online).toBe(true);
        expect(axios.get).toHaveBeenNthCalledWith(
            1,
            'https://example.com/master.m3u8',
            expect.objectContaining({ httpsAgent: expect.any(Object) })
        );
        expect(axios.get).toHaveBeenNthCalledWith(
            2,
            'https://example.com/variant/index.m3u8',
            expect.objectContaining({ httpsAgent: expect.any(Object) })
        );
    });

    it('returns a TLS-specific offline reason in strict mode', async () => {
        axios.get.mockRejectedValueOnce({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 13,
            is_online: 1,
            stream_source: 'external',
            external_hls_url: 'https://example.com/live.m3u8',
            external_tls_mode: 'strict'
        }, new Map());

        expect(result.online).toBe(false);
        expect(result.reason).toBe('tls_verification_failed');
    });
});

describe('cameraHealthService status transitions', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('suspends recording when a camera transitions offline', async () => {
        const service = new CameraHealthService();

        await service.handleCameraStatusTransition(
            { id: 41, enabled: 1, enable_recording: 1 },
            1,
            0,
            'http_404'
        );

        expect(handleCameraBecameOfflineMock).toHaveBeenCalledWith(41);
        expect(handleCameraBecameOnlineMock).not.toHaveBeenCalled();
        expect(refreshCameraThumbnailMock).not.toHaveBeenCalled();
    });

    it('resumes recording and refreshes thumbnail when a camera transitions online', async () => {
        const service = new CameraHealthService();

        await service.handleCameraStatusTransition(
            { id: 42, enabled: 1, enable_recording: 1 },
            0,
            1,
            'stream_recovered'
        );

        expect(handleCameraBecameOnlineMock).toHaveBeenCalledWith(42);
        expect(refreshCameraThumbnailMock).toHaveBeenCalledWith(42);
        expect(handleCameraBecameOfflineMock).not.toHaveBeenCalled();
    });

    it('does not trigger recording resume for cameras without recording enabled', async () => {
        const service = new CameraHealthService();

        await service.handleCameraStatusTransition(
            { id: 43, enabled: 1, enable_recording: 0 },
            0,
            1,
            'stream_recovered'
        );

        expect(handleCameraBecameOnlineMock).not.toHaveBeenCalled();
        expect(refreshCameraThumbnailMock).toHaveBeenCalledWith(43);
    });
});
