import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { PassThrough } from 'stream';

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
        get: vi.fn(),
        head: vi.fn()
    }
}));

function createReadableStream() {
    const stream = new PassThrough();
    stream.end('frame');
    return stream;
}

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

    it('detects #EXT-X-ENDLIST for stream ended streams', () => {
        const input = [
            '#EXTM3U',
            '#EXT-X-TARGETDURATION:6',
            '#EXT-X-MEDIA-SEQUENCE:2134',
            '#EXTINF:6.0,',
            'file2134.ts',
            '#EXT-X-ENDLIST'
        ].join('\n');

        const result = parsePlaylist(input);

        expect(result.ok).toBe(true);
        expect(result.hasEndList).toBe(true);
        expect(result.mediaSequence).toBe(2134);
    });
});

describe('cameraHealthService weighted scoring', () => {
    it('flags needsConfirmation after 3 ECONNREFUSED (weight=1.0)', () => {
        const service = new CameraHealthService();
        const camera = { id: 1, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyWeightedScoring(camera, { online: false, reason: 'ECONNREFUSED' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'ECONNREFUSED' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'ECONNREFUSED' })).toBe(1);
        
        const state = service.healthState.get(camera.id);
        expect(state.needsConfirmation).toBe(true);
        expect(state.failureScore).toBe(3);
        // It stays technically online until confirmed
        expect(state.effectiveOnline).toBe(true);
    });

    it('flags needsConfirmation after 15 timeouts (weight=0.2)', () => {
        const service = new CameraHealthService();
        const camera = { id: 2, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        for (let i = 0; i < 14; i++) {
            expect(service.applyWeightedScoring(camera, { online: false, reason: 'ECONNABORTED' })).toBe(1);
        }
        
        expect(service.healthState.get(camera.id).needsConfirmation).toBe(false);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'ECONNABORTED' })).toBe(1);
        expect(service.healthState.get(camera.id).needsConfirmation).toBe(true);
        expect(service.healthState.get(camera.id).failureScore).toBeCloseTo(3.0);
    });

    it('flags needsConfirmation after 6 stale_media_sequence (weight=0.5)', () => {
        const service = new CameraHealthService();
        const camera = { id: 5, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stale_media_sequence' })).toBe(1);
        
        expect(service.healthState.get(camera.id).needsConfirmation).toBe(true);
        expect(service.healthState.get(camera.id).failureScore).toBeCloseTo(3.0);
    });

    it('flags needsConfirmation after 3 stream_ended (weight=1.0)', () => {
        const service = new CameraHealthService();
        const camera = { id: 6, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stream_ended' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stream_ended' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'stream_ended' })).toBe(1);
        
        expect(service.healthState.get(camera.id).needsConfirmation).toBe(true);
        expect(service.healthState.get(camera.id).failureScore).toBeCloseTo(3.0);
    });

    it('switches online immediately after 1 success when score drops to 0', () => {
        const service = new CameraHealthService();
        const camera = { id: 3, is_online: 0 };

        service.ensureCameraState(camera.id, camera.is_online);
        // Set an initial small score
        service.healthState.get(camera.id).failureScore = 0.4;

        expect(service.applyWeightedScoring(camera, { online: true, reason: 'ok' })).toBe(1); // Score becomes 0, online
        expect(service.healthState.get(camera.id).effectiveOnline).toBe(true);
    });

    it('wipes out failure score instantly on success', () => {
        const service = new CameraHealthService();
        const camera = { id: 4, is_online: 1 };

        service.ensureCameraState(camera.id, camera.is_online);

        service.applyWeightedScoring(camera, { online: false, reason: 'ECONNREFUSED' }); // score = 1
        expect(service.healthState.get(camera.id).failureScore).toBe(1);

        service.applyWeightedScoring(camera, { online: true, reason: 'ok' }); // instant heal
        expect(service.healthState.get(camera.id).failureScore).toBe(0);
        expect(service.healthState.get(camera.id).effectiveOnline).toBe(true);
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

    it('recovers external MJPEG cameras from offline when the live stream opens even if snapshot is broken', async () => {
        axios.get.mockResolvedValueOnce({
            status: 200,
            headers: { 'content-type': 'multipart/x-mixed-replace; boundary=frame' },
            data: createReadableStream(),
        });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraStatus({
            id: 14,
            name: 'Jombang MJPEG',
            enabled: 1,
            is_online: 0,
            delivery_type: 'external_mjpeg',
            stream_source: 'external',
            external_snapshot_url: 'https://example.com/snapshot.jpg',
            external_stream_url: 'https://example.com/mjpeg',
            external_health_mode: 'probe_first',
        }, new Map());

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('mjpeg_stream_opened');
    });

    it('treats embed cameras with embed url as embed health checks instead of snapshot-first', async () => {
        axios.head.mockResolvedValueOnce({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 15,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_embed',
            external_embed_url: 'https://example.com/embed-page',
            external_snapshot_url: 'https://example.com/embed-snapshot.jpg',
        }, new Map());

        expect(result.online).toBe(true);
        expect(result.reason).toBe('embed_reachable');
        expect(result.details.probeTarget).toBe('https://example.com/embed-page');
        expect(result.details.runtimeTarget).toBe('https://example.com/embed-page');
    });

    it('marks MJPEG cameras online when HEAD fails but GET stream succeeds', async () => {
        axios.get.mockResolvedValueOnce({
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
            data: createReadableStream(),
        });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 18,
            enabled: 1,
            is_online: 0,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_stream_url: 'https://example.com/live.mjpg',
            external_health_mode: 'probe_first',
        }, new Map());

        expect(result.online).toBe(true);
        expect(result.reason).toBe('mjpeg_stream_opened');
        expect(result.details.probeTarget).toBe('https://example.com/live.mjpg');
    });

    it('surfaces probe target mismatch when snapshot fallback works but MJPEG stream probe fails', async () => {
        axios.get
            .mockRejectedValueOnce({ code: 'ECONNABORTED' })
            .mockResolvedValueOnce({
                status: 200,
                headers: { 'content-type': 'image/jpeg' },
                data: createReadableStream(),
            });

        const service = new CameraHealthService();
        const result = await service.evaluateCameraRaw({
            id: 19,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_stream_url: 'https://example.com/live.mjpg',
            external_snapshot_url: 'https://example.com/fallback.jpg',
            external_health_mode: 'probe_first',
        }, new Map());

        expect(result.online).toBe(true);
        expect(result.reason).toBe('probe_target_mismatch');
        expect(result.details.usedFallback).toBe(true);
    });

    it('uses passive-first MJPEG runtime evidence without probing backend by default', async () => {
        const service = new CameraHealthService();
        service.recordRuntimeSignal(393, {
            targetUrl: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
            signalType: 'external_mjpeg_open',
            success: true,
            timestamp: Date.now(),
        });

        const result = await service.evaluateCameraStatus({
            id: 393,
            name: 'PERBATASAN KABUH (SELATAN)',
            enabled: 1,
            is_online: 0,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_tls_mode: 'strict',
            external_stream_url: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
        }, new Map());

        const state = service.healthState.get(393);
        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('mjpeg_runtime_recent');
        expect(state.state).toBe('degraded_runtime_recent');
        expect(state.lastRuntimeSignalType).toBe('external_mjpeg_open');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('keeps MJPEG cameras degraded while passive runtime grace is still active', async () => {
        const service = new CameraHealthService();
        service.recordRuntimeSignal(394, {
            targetUrl: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=113',
            signalType: 'external_mjpeg_open',
            success: true,
            timestamp: Date.now() - 120000,
        });

        const result = await service.evaluateCameraStatus({
            id: 394,
            name: 'MJPEG Grace Camera',
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_stream_url: 'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=113',
        }, new Map());

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('mjpeg_runtime_grace');
        expect(service.healthState.get(394).state).toBe('degraded_runtime_grace');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('downgrades MJPEG passive-first cameras after grace but before final stale timeout', async () => {
        const service = new CameraHealthService();
        service.recordRuntimeSignal(397, {
            targetUrl: 'https://example.com/mjpeg',
            signalType: 'external_mjpeg_live_tick',
            success: true,
            timestamp: Date.now() - (5 * 60 * 1000),
        });

        const result = await service.evaluateCameraStatus({
            id: 397,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_stream_url: 'https://example.com/mjpeg',
        }, new Map());

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('stale_passive');
        expect(service.healthState.get(397).state).toBe('degraded_runtime_grace');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('maps degraded MJPEG runtime state to public degraded availability', () => {
        const service = new CameraHealthService();
        service.healthState.set(395, {
            effectiveOnline: true,
            state: 'degraded_runtime_recent',
            confidence: 0.71,
            lastReason: 'mjpeg_runtime_recent',
            errorClass: 'network_transient',
        });

        expect(service.getPublicAvailability({
            id: 395,
            status: 'active',
            is_online: 0,
        })).toEqual({
            availability_state: 'degraded',
            availability_reason: 'mjpeg_runtime_recent',
            availability_confidence: 0.71,
        });
    });

    it('keeps hard config failures offline in public availability', () => {
        const service = new CameraHealthService();
        service.healthState.set(396, {
            effectiveOnline: false,
            state: 'unresolved',
            confidence: 0.22,
            lastReason: 'missing_external_source_metadata',
            errorClass: 'config',
        });

        expect(service.getPublicAvailability({
            id: 396,
            status: 'active',
            is_online: 1,
        })).toEqual({
            availability_state: 'offline',
            availability_reason: 'missing_external_source_metadata',
            availability_confidence: 0.22,
        });
    });

    it('keeps websocket external cameras online by default when no probe target exists', async () => {
        const service = new CameraHealthService();
        const result = await service.evaluateCameraStatus({
            id: 16,
            enabled: 1,
            is_online: 0,
            delivery_type: 'external_custom_ws',
            external_stream_url: 'wss://example.com/stream',
        }, new Map());

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('assumed_online_no_probe_target');
    });

    it('marks legacy external cameras without source metadata as unresolved', async () => {
        const service = new CameraHealthService();
        const result = await service.evaluateCameraStatus({
            id: 17,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'internal_hls',
            private_rtsp_url: '',
            external_hls_url: null,
            external_stream_url: null,
            external_embed_url: null,
            external_snapshot_url: null,
        }, new Map());

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('missing_external_source_metadata');
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

describe('cameraHealthService health debug pagination', () => {
    it('filters problem cameras and paginates results for the debug page', () => {
        const service = new CameraHealthService();
        service.getHealthDebugSnapshot = vi.fn(() => ([
            {
                cameraId: 1,
                cameraName: 'Healthy Camera',
                state: 'healthy',
                confidence: 0.95,
                errorClass: null,
                delivery_type: 'internal_hls',
                availability_state: 'online',
            },
            {
                cameraId: 2,
                cameraName: 'TLS MJPEG',
                state: 'degraded',
                confidence: 0.45,
                errorClass: 'tls',
                delivery_type: 'external_mjpeg',
                availability_state: 'degraded',
                lastReason: 'runtime_probe_tls_mismatch',
                providerDomain: 'cctv.jombangkab.go.id',
            },
            {
                cameraId: 3,
                cameraName: 'Offline HLS',
                state: 'offline',
                confidence: 0.2,
                errorClass: 'network_transient',
                delivery_type: 'external_hls',
                availability_state: 'offline',
                lastReason: 'timeout',
                providerDomain: 'data.bojonegorokab.go.id',
            },
        ]));

        const result = service.getHealthDebugPage({
            state: 'problem',
            search: 'kab',
            page: 1,
            limit: 1,
            sort: 'severity',
        });

        expect(result.summary).toMatchObject({
            total: 3,
            healthy: 1,
            degraded: 1,
            offline: 1,
        });
        expect(result.items).toHaveLength(1);
        expect(result.items[0].cameraId).toBe(3);
        expect(result.pagination).toMatchObject({
            page: 1,
            limit: 1,
            totalItems: 2,
            totalPages: 2,
            hasNextPage: true,
        });
    });
});
