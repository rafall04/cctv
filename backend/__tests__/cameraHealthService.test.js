/*
Purpose: Regression coverage for camera health monitoring, probing, and recording transition behavior.
Caller: Vitest backend suite.
Deps: CameraHealthService, mocked recording/thumbnail/media services, connectionPool spies.
MainFuncs: CameraHealthService test cases for probes, scoring, transitions, and health loops.
SideEffects: Mocks network, database, MediaMTX, recording, and thumbnail interactions.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import net from 'net';
import { PassThrough } from 'stream';
import * as connectionPool from '../database/connectionPool.js';

const {
    handleCameraBecameOnlineMock,
    handleCameraBecameOfflineMock,
    refreshCameraThumbnailMock,
    updateCameraPathMock,
    queryMock,
    executeMock,
    transactionMock,
    upsertRuntimeStateMock,
} = vi.hoisted(() => ({
    handleCameraBecameOnlineMock: vi.fn(),
    handleCameraBecameOfflineMock: vi.fn(),
    refreshCameraThumbnailMock: vi.fn(),
    updateCameraPathMock: vi.fn(),
    queryMock: vi.fn(),
    executeMock: vi.fn(),
    transactionMock: vi.fn((fn) => (...args) => fn(...args)),
    upsertRuntimeStateMock: vi.fn(),
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

vi.mock('../services/mediaMtxService.js', () => ({
    default: {
        updateCameraPath: updateCameraPathMock,
    },
}));

vi.mock('../services/telegramService.js', () => ({
    sendCameraOfflineNotification: vi.fn(),
    sendCameraOnlineNotification: vi.fn(),
    sendCameraStatusNotifications: vi.fn(),
    isTelegramConfigured: vi.fn(() => false),
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: vi.fn(),
    execute: executeMock,
    transaction: transactionMock,
}));

vi.mock('../services/timezoneService.js', () => ({
    getTimezone: vi.fn(() => 'Asia/Jakarta'),
}));

vi.mock('../services/cameraRuntimeStateService.js', () => ({
    default: {
        upsertRuntimeState: upsertRuntimeStateMock,
    },
}));

import {
    CameraHealthService,
    buildExternalRequestOptions,
    mapExternalFetchError,
    normalizeExternalTlsMode,
    parsePlaylist,
    probeRtspSource,
} from '../services/cameraHealthService.js';

vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        head: vi.fn()
    }
}));

describe('CameraHealthService runtime reset', () => {
    it('clears per-camera health runtime state after source refresh', () => {
        const service = new CameraHealthService();

        service.healthState.set(7, { state: 'healthy', lastReason: 'mediamtx_path_ready' });
        service.offlineSince.set(7, Date.now());
        service.probeCache.set('camera:7', { result: { online: true }, expiresAt: Date.now() + 1000 });
        service.internalPathRepairBackoff.set('stream-key-7', Date.now() + 1000);
        service.lastActivePathMap.set('stream-key-7', { ready: true });

        service.clearCameraRuntimeState(7, 'stream-key-7');

        expect(service.healthState.has(7)).toBe(false);
        expect(service.offlineSince.has(7)).toBe(false);
        expect(service.probeCache.has('camera:7')).toBe(false);
        expect(service.internalPathRepairBackoff.has('stream-key-7')).toBe(false);
        expect(service.lastActivePathMap.has('stream-key-7')).toBe(false);
    });
});

function createReadableStream() {
    const stream = new PassThrough();
    stream.end('frame');
    return stream;
}

async function createRtspTestServer(handler) {
    const server = net.createServer((socket) => {
        let requestBuffer = '';

        socket.on('data', (chunk) => {
            requestBuffer += chunk.toString('utf8');
            if (requestBuffer.includes('\r\n\r\n')) {
                handler(socket, requestBuffer);
            }
        });
    });

    await new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', (error) => {
            if (error) {
                reject(error);
                return;
            }
            resolve();
        });
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to bind RTSP test server');
    }

    return {
        server,
        port: address.port,
        close: () => new Promise((resolve, reject) => {
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve();
            });
        }),
    };
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

describe('cameraHealthService internal RTSP probe', () => {
    it('marks RTSP online after digest auth succeeds', async () => {
        let requestCount = 0;
        const testServer = await createRtspTestServer((socket, requestText) => {
            requestCount += 1;

            if (requestCount === 1) {
                socket.end([
                    'RTSP/1.0 401 Unauthorized',
                    'CSeq: 1',
                    'WWW-Authenticate: Digest realm="Surabaya", nonce="abc123", qop="auth"',
                    '',
                    '',
                ].join('\r\n'));
                return;
            }

            expect(requestText).toContain('Authorization: Digest ');
            expect(requestText).toContain('username="admin"');
            socket.end([
                'RTSP/1.0 200 OK',
                'CSeq: 2',
                'Content-Length: 0',
                '',
                '',
            ].join('\r\n'));
        });

        try {
            const result = await probeRtspSource(`rtsp://admin:secret@127.0.0.1:${testServer.port}/mpeg4/ch39/sub/av_stream`, 2000);

            expect(result.online).toBe(true);
            expect(result.reason).toBe('rtsp_auth_ok');
            expect(result.details.rtspAuthScheme).toBe('digest');
        } finally {
            await testServer.close();
        }
    });

    it('marks RTSP offline when auth challenge cannot be satisfied', async () => {
        const testServer = await createRtspTestServer((socket) => {
            socket.end([
                'RTSP/1.0 401 Unauthorized',
                'CSeq: 1',
                'WWW-Authenticate: Digest realm="Surabaya", nonce="abc123", qop="auth"',
                '',
                '',
            ].join('\r\n'));
        });

        try {
            const result = await probeRtspSource(`rtsp://127.0.0.1:${testServer.port}/mpeg4/ch39/sub/av_stream`, 2000);

            expect(result.online).toBe(false);
            expect(result.reason).toBe('rtsp_auth_failed');
        } finally {
            await testServer.close();
        }
    });
});

describe('cameraHealthService external TLS policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        updateCameraPathMock.mockResolvedValue({ success: true, action: 'added' });
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

    it('keeps internal cameras online from MediaMTX path readiness without probing RTSP again', async () => {
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource');

        const result = await service.evaluateCameraRaw({
            id: 130,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'surabaya-130',
            private_rtsp_url: 'rtsp://admin:secret@127.0.0.1:554/live',
        }, new Map([
            ['surabaya-130', { ready: true, sourceReady: true, readers: 1 }],
        ]));

        expect(result.online).toBe(true);
        expect(result.reason).toBe('mediamtx_path_ready');
        expect(probeSpy).not.toHaveBeenCalled();
    });

    it('keeps local internal cameras online when MediaMTX path is configured but idle', async () => {
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource');

        const result = await service.evaluateCameraRaw({
            id: 131,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'local-131',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.5:554/live',
            enable_recording: 1,
            description: 'Local gate camera',
        }, new Map([
            ['local-131', { configured: true, ready: false, sourceReady: false, readers: 0 }],
        ]));

        expect(result.online).toBe(true);
        expect(result.reason).toBe('mediamtx_path_configured_idle');
        expect(probeSpy).not.toHaveBeenCalled();
    });

    it('keeps local internal cameras online when MediaMTX path is missing but source is non-strict internal RTSP', async () => {
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource');

        const result = await service.evaluateCameraRaw({
            id: 132,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'local-132',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.6:554/live',
            enable_recording: 1,
            description: 'Warehouse camera',
        }, new Map());

        expect(result.online).toBe(true);
        expect(result.reason).toBe('mediamtx_path_repaired');
        expect(updateCameraPathMock).toHaveBeenCalledWith(
            'local-132',
            'rtsp://admin:secret@10.0.0.6:554/live',
            expect.objectContaining({ id: 132 })
        );
        expect(probeSpy).not.toHaveBeenCalled();
    });

    it('marks private RTSP live-only cameras offline when RTSP auth fails and MediaMTX path is idle', async () => {
        const service = new CameraHealthService();
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {
                probeTarget: 'rtsp://masked',
            },
        });

        const result = await service.evaluateCameraRaw({
            id: 131,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'surabaya-131',
            private_rtsp_url: 'rtsp://admin:wrong@127.0.0.1:554/live',
            enable_recording: 0,
            description: 'SOURCE: PRIVATE RTSP LIVE ONLY | source_tag: surabaya_private_rtsp | notes: imported',
        }, new Map());

        expect(result.online).toBe(false);
        expect(result.reason).toBe('rtsp_auth_failed');
        expect(result.details.probeTarget).toBe('rtsp://masked');
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

    it('uses passive-first FLV runtime evidence without probing backend by default', async () => {
        const service = new CameraHealthService();
        service.recordRuntimeSignal(401, {
            targetUrl: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
            signalType: 'external_flv_runtime_playing',
            success: true,
            timestamp: Date.now(),
        });

        const result = await service.evaluateCameraStatus({
            id: 401,
            name: 'BALAIKOTA',
            enabled: 1,
            is_online: 0,
            stream_source: 'external',
            delivery_type: 'external_flv',
            external_stream_url: 'https://surakarta.atcsindonesia.info:8086/camera/BalaiKota.flv',
        }, new Map());

        const state = service.healthState.get(401);
        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('flv_runtime_recent');
        expect(state.state).toBe('healthy');
        expect(state.lastRuntimeSignalType).toBe('external_flv_runtime_playing');
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

    it('keeps disabled MJPEG cameras online without runtime signal and skips probing', async () => {
        const service = new CameraHealthService();

        const result = await service.evaluateCameraStatus({
            id: 398,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_health_mode: 'disabled',
            external_stream_url: 'https://example.com/mjpeg',
        }, new Map());

        const state = service.healthState.get(398);
        const monitoring = service.getMonitoringState({
            id: 398,
            delivery_type: 'external_mjpeg',
            external_health_mode: 'disabled',
        }, state);

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('health_check_disabled');
        expect(state.state).toBe('disabled');
        expect(state.effectiveOnline).toBe(true);
        expect(monitoring).toEqual({
            health_mode: 'disabled',
            monitoring_state: 'disabled',
            monitoring_reason: 'health_check_disabled',
        });
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('keeps disabled MJPEG cameras online with runtime metadata and skips probing', async () => {
        const service = new CameraHealthService();
        service.recordRuntimeSignal(399, {
            targetUrl: 'https://example.com/mjpeg',
            signalType: 'external_mjpeg_open',
            success: true,
            timestamp: Date.now() - 30_000,
        });

        const result = await service.evaluateCameraStatus({
            id: 399,
            enabled: 1,
            is_online: 0,
            stream_source: 'external',
            delivery_type: 'external_mjpeg',
            external_health_mode: 'disabled',
            external_stream_url: 'https://example.com/mjpeg',
        }, new Map());

        const state = service.healthState.get(399);

        expect(result.isOnline).toBe(1);
        expect(result.rawReason).toBe('mjpeg_runtime_recent');
        expect(state.state).toBe('disabled');
        expect(state.effectiveOnline).toBe(true);
        expect(state.lastRuntimeSignalType).toBe('external_mjpeg_open');
        expect(axios.get).not.toHaveBeenCalled();
    });

    it('keeps hard config failures offline even when health mode is disabled', async () => {
        const service = new CameraHealthService();

        const result = await service.evaluateCameraStatus({
            id: 400,
            enabled: 1,
            is_online: 1,
            stream_source: 'external',
            delivery_type: 'external_unresolved',
            external_health_mode: 'disabled',
        }, new Map());

        expect(result.isOnline).toBe(0);
        expect(result.rawReason).toBe('missing_external_source_metadata');
        expect(service.healthState.get(400).state).toBe('unresolved');
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

    it('keeps public availability derived from existing availability state, not Telegram transition side effects', () => {
        const service = new CameraHealthService();
        const camera = {
            id: 397,
            is_online: 1,
            status: 'active',
            delivery_type: 'internal_hls',
        };

        const state = service.ensureCameraState(camera.id, camera.is_online);
        state.effectiveOnline = true;
        state.state = 'healthy';
        state.lastReason = 'mediamtx_path_ready';
        state.confidence = 0.98;

        expect(service.getPublicAvailability(camera)).toEqual({
            availability_state: 'online',
            availability_reason: 'mediamtx_path_ready',
            availability_confidence: 0.98,
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

describe('cameraHealthService check loop', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('processes fulfilled probe results without camera variable shadowing failures', async () => {
        const service = new CameraHealthService();
        const camera = {
            id: 51,
            name: 'Camera Check Loop',
            enabled: 1,
            is_online: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.51/stream',
            stream_key: 'camera-51',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'ok',
            rawDetails: null,
        });
        queryMock.mockReturnValue([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await expect(service.checkAllCameras()).resolves.toBeUndefined();

        expect(service.evaluateCameraStatus).toHaveBeenCalledWith(camera, expect.any(Map));
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE cameras SET is_online'),
            expect.arrayContaining([1, expect.any(String), 51])
        );
    });

    it('hydrates detailed camera rows only for due cameras in the health loop', async () => {
        const service = new CameraHealthService();
        const dueCamera = {
            id: 51,
            name: 'Due Camera',
            enabled: 1,
            is_online: 1,
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.51/stream',
            stream_key: 'camera-51',
        };

        service.ensureCameraState(52, 1).nextCheckAt = Date.now() + 60_000;

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera: dueCamera,
            isOnline: 1,
            rawReason: 'ok',
            rawDetails: null,
        });
        queryMock
            .mockReturnValueOnce([
                { id: 51, is_online: 1 },
                { id: 52, is_online: 1 },
            ])
            .mockReturnValueOnce([dueCamera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await expect(service.checkAllCameras()).resolves.toBeUndefined();

        expect(queryMock).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining('SELECT c.id, c.is_online')
        );
        expect(queryMock).toHaveBeenNthCalledWith(
            2,
            expect.stringContaining('AND c.id IN (?)'),
            [51]
        );
        expect(service.evaluateCameraStatus).toHaveBeenCalledTimes(1);
        expect(service.evaluateCameraStatus).toHaveBeenCalledWith(dueCamera, expect.any(Map));
    });

    it('updates monitoring offline immediately when stream availability stays online but delays Telegram alert', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 61,
            name: 'Always On Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.61/stream',
            stream_key: 'camera-61',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
            isOnline: 0,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_stream_not_found',
        });

        queryMock
            .mockReturnValueOnce([{ id: 61, is_online: 1 }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(connectionPool.execute).toHaveBeenCalledWith(
            expect.stringContaining('UPDATE cameras SET is_online'),
            expect.arrayContaining([1, expect.any(String), 61])
        );
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(61, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_stream_not_found',
        }));
    });

    it('does not send Telegram when monitoring state has not crossed online/offline boundary', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 62,
            name: 'Stable Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.62/stream',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_ready',
            rawDetails: null,
        });
        vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
            isOnline: 1,
            monitoring_state: 'online',
            monitoring_reason: 'rtsp_reachable',
        });

        queryMock
            .mockReturnValueOnce([{ id: 62, is_online: 1 }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
    });

    it('does not send Telegram DOWN for default internal HLS when direct RTSP would fail but stream health is online', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 63,
            name: 'Default Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:wrong@10.0.0.63/stream',
            stream_key: 'camera-63',
            internal_ingest_policy_override: 'default',
            area_internal_ingest_policy_default: 'default',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        const rtspProbeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 63, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(rtspProbeSpy).not.toHaveBeenCalled();
        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(63, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'online',
            monitoring_reason: 'mediamtx_path_configured_idle',
        }));
    });

    it('updates explicit strict internal HLS monitoring offline immediately when RTSP probe fails', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        const camera = {
            id: 64,
            name: 'Explicit Strict Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:wrong@10.0.0.64/stream',
            stream_key: 'camera-64',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 64, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(64, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_auth_failed',
        }));
    });

    it('updates runtime offline immediately but delays Telegram DOWN until confirmation window passes', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };

        const camera = {
            id: 65,
            name: 'Delayed Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.65/stream',
            stream_key: 'camera-65',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(Date, 'now').mockReturnValue(1_000);
        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 65, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).not.toHaveBeenCalled();
        expect(upsertRuntimeStateMock).toHaveBeenCalledWith(65, expect.objectContaining({
            is_online: 1,
            monitoring_state: 'offline',
            monitoring_reason: 'rtsp_auth_failed',
        }));
    });

    it('sends Telegram DOWN after offline state stays stable through the confirmation window', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };
        service.telegramAlertState.set(66, {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 1_000,
            lastObservedState: 'offline',
            lastUpdatedAt: 1_000,
        });

        const camera = {
            id: 66,
            name: 'Confirmed Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.66/stream',
            stream_key: 'camera-66',
            internal_ingest_policy_override: 'always_on',
        };

        vi.spyOn(Date, 'now').mockReturnValue(121_000);
        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'mediamtx_path_configured_idle',
            rawDetails: null,
        });
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_auth_failed',
            details: {},
        });

        queryMock
            .mockReturnValueOnce([{ id: 66, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [camera]);
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
