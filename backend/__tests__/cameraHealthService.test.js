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
    reconcileCameraLifecycleMock,
    refreshCameraThumbnailMock,
    updateCameraPathMock,
    queryMock,
    executeMock,
    transactionMock,
    upsertRuntimeStateMock,
    getAlertStateMapMock,
    upsertAlertStatesMock,
} = vi.hoisted(() => ({
    handleCameraBecameOnlineMock: vi.fn(),
    handleCameraBecameOfflineMock: vi.fn(),
    reconcileCameraLifecycleMock: vi.fn(),
    refreshCameraThumbnailMock: vi.fn(),
    updateCameraPathMock: vi.fn(),
    queryMock: vi.fn(),
    executeMock: vi.fn(),
    transactionMock: vi.fn((fn) => (...args) => fn(...args)),
    upsertRuntimeStateMock: vi.fn(),
    getAlertStateMapMock: vi.fn(() => new Map()),
    upsertAlertStatesMock: vi.fn(),
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        handleCameraBecameOnline: handleCameraBecameOnlineMock,
        handleCameraBecameOffline: handleCameraBecameOfflineMock,
        reconcileRecordingLifecycle: reconcileCameraLifecycleMock,
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

vi.mock('../services/cameraTelegramAlertStateRepository.js', () => ({
    default: {
        getStateMap: getAlertStateMapMock,
        upsertStates: upsertAlertStatesMock,
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

    it('schedules the next check around the backoff expiry when a probe returns provider_backoff_active', () => {
        // Without this nudge, a cold-tier camera (5 min cadence) on a
        // briefly-backed-off provider would not be re-probed until the
        // regular cadence wakes it — adding up to ~5 min to recovery
        // latency. The scheduler should aim for backoffUntil + jitter
        // instead, so a recovered upstream is picked up promptly.
        const service = new CameraHealthService();
        const camera = {
            id: 8,
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_hls_url: 'https://cctv.example.gov.id/live.m3u8',
        };
        const state = service.ensureCameraState(camera.id, 1);
        // Force a slow cadence (cold tier).
        state.stableFailureCount = 10;

        const before = Date.now();
        const backoffUntilMs = before + 60_000; // 60s from now
        const rawResult = {
            online: false,
            reason: 'provider_backoff_active',
            details: { domainBackoffUntil: new Date(backoffUntilMs).toISOString() },
        };

        service.scheduleNextCameraCheck(camera, state, rawResult);

        // Should wake within the small jitter window after the backoff
        // expires, NOT 5 min later via the cold cadence.
        expect(state.nextCheckAt).toBeGreaterThanOrEqual(backoffUntilMs);
        expect(state.nextCheckAt).toBeLessThanOrEqual(backoffUntilMs + 4000);
    });

    it('keeps the normal cadence when the rawResult has no backoff signal', () => {
        // Regression: the backoff-aware branch must not interfere with
        // non-backoff scheduling — the cold cadence remains the source
        // of truth when the probe didn't come back with
        // provider_backoff_active.
        const service = new CameraHealthService();
        const camera = {
            id: 9,
            stream_source: 'external',
            delivery_type: 'external_hls',
            external_hls_url: 'https://cctv.example.gov.id/live.m3u8',
        };
        const state = service.ensureCameraState(camera.id, 0);
        state.stableFailureCount = 10; // cold tier

        const before = Date.now();
        const rawResult = { online: false, reason: 'http_502', details: {} };

        service.scheduleNextCameraCheck(camera, state, rawResult);

        // Cold cadence = 5 min. Should land roughly there, not within
        // the next few seconds.
        expect(state.nextCheckAt - before).toBeGreaterThan(60_000);
    });
});

function createReadableStream() {
    const stream = new PassThrough();
    stream.end('frame');
    return stream;
}

async function createRtspTestServer(handler) {
    // Session-aware mock. probeRtspSource now keeps a single TCP
    // connection open across the challenge-response handshake (see the
    // production runRtspChallengeResponseSession comment for why — HIK
    // V4 firmware on the Surabaya cameras rotates the digest nonce
    // every new connection, so the OLD socket-per-request mock pattern
    // is no longer faithful to what the prod code does). Each request
    // boundary in the same connection invokes the handler with an
    // incrementing requestIndex; the handler decides whether to
    // `socket.write(...)` (and stay alive for the next request) or
    // `socket.end(...)` (and close).
    const server = net.createServer((socket) => {
        let requestBuffer = '';
        let requestIndex = 0;

        socket.on('data', (chunk) => {
            requestBuffer += chunk.toString('utf8');
            // Drain any number of full requests buffered together.
            while (requestBuffer.includes('\r\n\r\n')) {
                const boundary = requestBuffer.indexOf('\r\n\r\n') + 4;
                const requestText = requestBuffer.slice(0, boundary);
                requestBuffer = requestBuffer.slice(boundary);
                requestIndex += 1;
                handler(socket, requestText, requestIndex);
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

    it('does NOT instantly hard-offline an internal camera on rtsp_stream_not_found (debounces via score)', () => {
        // RC-B regression: a MediaMTX-owned single-session camera answers a
        // transient 454/404 to an independent probe while streaming fine.
        // One such probe must not force it offline; it debounces like any
        // other failure and the MediaMTX fast-path resets the score.
        const service = new CameraHealthService();
        const camera = { id: 210, is_online: 1, delivery_type: 'internal_hls' };
        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyWeightedScoring(camera, { online: false, reason: 'rtsp_stream_not_found' })).toBe(1);
        let state = service.healthState.get(camera.id);
        expect(state.effectiveOnline).toBe(true);
        expect(state.failureScore).toBeCloseTo(1.0);

        // Repeats still cross the threshold -> flagged for confirmation, so a
        // genuinely-dead source is not masked forever.
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'rtsp_stream_not_found' })).toBe(1);
        expect(service.applyWeightedScoring(camera, { online: false, reason: 'rtsp_stream_not_found' })).toBe(1);
        state = service.healthState.get(camera.id);
        expect(state.needsConfirmation).toBe(true);
        expect(state.failureScore).toBeGreaterThanOrEqual(3.0);
    });

    it('still instantly hard-offlines an internal camera on a genuine config error (invalid_rtsp_url)', () => {
        const service = new CameraHealthService();
        const camera = { id: 211, is_online: 1, delivery_type: 'internal_hls' };
        service.ensureCameraState(camera.id, camera.is_online);

        expect(service.applyWeightedScoring(camera, { online: false, reason: 'invalid_rtsp_url' })).toBe(0);
        expect(service.healthState.get(camera.id).effectiveOnline).toBe(false);
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
    it('marks RTSP online after digest auth succeeds on the SAME socket (Surabaya HIK firmware)', async () => {
        // Regression: HIK Media Server V4.51.127 (Surabaya / Edishub
        // CCTVs) generates a fresh digest nonce for every new TCP
        // connection. If the second DESCRIBE lands on a different
        // socket, the server rejects the auth with another 401 and
        // the camera reports offline despite being fully reachable.
        // The fix is to keep one socket open for both passes; this
        // test pins that behaviour.
        const testServer = await createRtspTestServer((socket, requestText, requestIndex) => {
            if (requestIndex === 1) {
                // 401 with challenge — but do NOT close the socket.
                // The probe must reuse this connection for pass 2 so
                // the nonce above stays valid.
                socket.write([
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

    it('survives a server that rotates the digest nonce per TCP connection (Surabaya HIK regression)', async () => {
        // Direct simulation of the Surabaya bug: each new connection
        // yields a DIFFERENT nonce. The old probe (one socket per
        // request) would never authenticate against such a server.
        // The fixed probe stays on one socket so the nonce delivered
        // with the 401 stays valid for the immediately-following
        // DESCRIBE+Digest reply.
        let connectionCount = 0;
        const server = net.createServer((socket) => {
            connectionCount += 1;
            const connectionNonce = `nonce-conn-${connectionCount}`;
            let buf = '';
            let perConnIndex = 0;
            socket.on('data', (chunk) => {
                buf += chunk.toString('utf8');
                while (buf.includes('\r\n\r\n')) {
                    const boundary = buf.indexOf('\r\n\r\n') + 4;
                    const requestText = buf.slice(0, boundary);
                    buf = buf.slice(boundary);
                    perConnIndex += 1;

                    if (perConnIndex === 1) {
                        socket.write([
                            'RTSP/1.0 401 Unauthorized',
                            'CSeq: 1',
                            `WWW-Authenticate: Digest realm="HIK", nonce="${connectionNonce}", algorithm="MD5"`,
                            '',
                            '',
                        ].join('\r\n'));
                        continue;
                    }

                    // Validate the digest was built against THIS
                    // connection's nonce — if the prod code opened a
                    // new socket for pass 2, the server would see a
                    // fresh perConnIndex===1, never reach this
                    // branch, and we'd loop on 401s forever.
                    expect(requestText).toContain(`nonce="${connectionNonce}"`);
                    socket.end([
                        'RTSP/1.0 200 OK',
                        'CSeq: 2',
                        'Content-Length: 0',
                        '',
                        '',
                    ].join('\r\n'));
                }
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const result = await probeRtspSource(`rtsp://admin:secret@127.0.0.1:${port}/ch1/main`, 2000);
            expect(result.online).toBe(true);
            expect(result.reason).toBe('rtsp_auth_ok');
            // The connection count is the canary: the probe must
            // accomplish auth in EXACTLY one TCP connection. Two or
            // more means the regression has come back.
            expect(connectionCount).toBe(1);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('falls back to a fresh socket when the server closes after the 401 (older Dahua / generic ONVIF regression)', async () => {
        // The flip side of the Surabaya HIK case: a lot of older DVR /
        // NVR firmwares close the TCP connection right after sending
        // the 401, treating each request as a brand-new session. The
        // probe must reconnect for pass 2 instead of riding the
        // already-closed socket.
        //
        // This test stands up a server that:
        //   - On connection #1: 401 then immediately `socket.end()`.
        //   - On connection #2: expects DESCRIBE+Digest with the
        //     original nonce, returns 200.
        // The connection count being EXACTLY 2 pins that the fallback
        // ran (and only ran once).
        let connectionCount = 0;
        const server = net.createServer((socket) => {
            connectionCount += 1;
            const captured = connectionCount;
            let buf = '';
            // Once we've sent a response and called socket.end(), the
            // client's already-queued pass-2 bytes may still arrive on
            // our side before TCP fully tears the connection down —
            // emitting another 'data' event. Without this guard we'd
            // try to socket.end() on an already-ended stream, which
            // logs an ERR_STREAM_WRITE_AFTER_END unhandled error and
            // pollutes the test output (the test functionally passes
            // either way — it's pure noise).
            let responded = false;
            socket.on('data', (chunk) => {
                if (responded) return;
                buf += chunk.toString('utf8');
                if (!buf.includes('\r\n\r\n')) return;

                if (captured === 1) {
                    // Pass 1: 401 challenge, then immediately HUP.
                    socket.end([
                        'RTSP/1.0 401 Unauthorized',
                        'CSeq: 1',
                        'WWW-Authenticate: Digest realm="Dahua", nonce="legacy-nonce-XYZ", algorithm="MD5"',
                        '',
                        '',
                    ].join('\r\n'));
                    responded = true;
                    return;
                }
                // Pass 2 must arrive on a NEW connection AND carry the
                // ORIGINAL nonce — the fallback's whole job is to
                // honour what pass 1 issued.
                expect(buf).toContain('nonce="legacy-nonce-XYZ"');
                socket.end([
                    'RTSP/1.0 200 OK',
                    'CSeq: 2',
                    'Content-Length: 0',
                    '',
                    '',
                ].join('\r\n'));
                responded = true;
            });
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;

        try {
            const result = await probeRtspSource(`rtsp://admin:secret@127.0.0.1:${port}/ch1/main`, 2000);
            expect(result.online).toBe(true);
            expect(result.reason).toBe('rtsp_auth_ok');
            expect(connectionCount).toBe(2);
        } finally {
            await new Promise((resolve) => server.close(resolve));
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

    it('verifies RTSP source for non-strict internal cameras when MediaMTX path is configured but idle (probe online → stays online)', async () => {
        // Before the Opsi B fix, "path configured but idle" was treated as
        // online unconditionally — that masked dead RTSP sources (UDP
        // especially, where MediaMTX never sees a connection drop). The
        // probe is now called to confirm. When the probe says the source
        // is reachable, we stay online but mark the reason so debug logs
        // show both signals.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: true,
            reason: 'rtsp_describe_ok',
            details: {},
        });

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
        expect(result.reason).toBe('mediamtx_path_configured_idle+rtsp_verified');
        expect(probeSpy).toHaveBeenCalledWith('rtsp://admin:secret@10.0.0.5:554/live');
    });

    it('marks non-strict internal cameras OFFLINE when MediaMTX path is configured-idle but RTSP source is dead (UDP / TCP both)', async () => {
        // The actual bug from the field: a UDP-only camera went down,
        // MediaMTX kept the path configured, and the dashboard reported
        // it online forever. The verification probe must override the
        // MediaMTX-optimistic state.
        const service = new CameraHealthService();
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'internal_stream_unreachable',
            details: { rtspHost: '10.0.0.5', rtspPort: 554 },
        });

        const result = await service.evaluateCameraRaw({
            id: 131,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'local-131',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.5:554/live',
            enable_recording: 1,
        }, new Map([
            ['local-131', { configured: true, ready: false, sourceReady: false, readers: 0 }],
        ]));

        expect(result.online).toBe(false);
        expect(result.reason).toBe('internal_stream_unreachable');
    });

    it('verifies RTSP source after MediaMTX path repair (probe online → stays online with verified reason)', async () => {
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: true,
            reason: 'rtsp_describe_ok',
            details: {},
        });

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
        expect(result.reason).toBe('mediamtx_path_repaired+rtsp_verified');
        expect(updateCameraPathMock).toHaveBeenCalledWith(
            'local-132',
            'rtsp://admin:secret@10.0.0.6:554/live',
            expect.objectContaining({ id: 132 })
        );
        expect(probeSpy).toHaveBeenCalled();
    });

    it('marks non-strict internal cameras OFFLINE after MediaMTX path repair when RTSP source is unreachable', async () => {
        // Registering a path with MediaMTX is just a config write — it
        // doesn't confirm the upstream RTSP is alive. The verifier must
        // catch this case too.
        const service = new CameraHealthService();
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'internal_stream_unreachable',
            details: {},
        });

        const result = await service.evaluateCameraRaw({
            id: 132,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'local-132',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.6:554/live',
            enable_recording: 1,
        }, new Map());

        expect(result.online).toBe(false);
        expect(result.reason).toBe('internal_stream_unreachable');
    });

    it('verifies RTSP source for the UDP sourceReady-true-but-no-readers trap', async () => {
        // UDP-only camera: MediaMTX bound the port and reports
        // sourceReady=true, but no media is actually flowing and zero
        // viewers are pulling. This used to short-circuit at the
        // pathInfo.sourceReady check and report online. The fix triggers
        // a real RTSP DESCRIBE to disambiguate.
        const service = new CameraHealthService();
        vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'internal_stream_unreachable',
            details: {},
        });

        const result = await service.evaluateCameraRaw({
            id: 140,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'udp-140',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.7:554/live',
            enable_recording: 1,
        }, new Map([
            ['udp-140', { configured: true, ready: false, sourceReady: true, readers: 0 }],
        ]));

        expect(result.online).toBe(false);
        expect(result.reason).toBe('internal_stream_unreachable');
    });

    it('trusts MediaMTX without an independent RTSP probe when the source is actively receiving (sourceProgressing)', async () => {
        // RC-B regression: cheap cameras (e.g. RtpRtspFlyer) allow a single
        // RTSP session. MediaMTX owns it, so an independent DESCRIBE gets 454
        // Session Not Found → the camera flaps offline despite streaming fine.
        // When MediaMTX reports the source is actually pulling bytes, trust it
        // and skip the colliding probe.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'rtsp_stream_not_found',
            details: {},
        });

        const result = await service.evaluateCameraRaw({
            id: 144,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'active-144',
            private_rtsp_url: 'rtsp://admin:secret@192.168.14.3:554/stream1',
            enable_recording: 1,
        }, new Map([
            ['active-144', { configured: true, ready: false, sourceReady: true, readers: 0, bytesReceived: 12345, sourceProgressing: true }],
        ]));

        expect(result.online).toBe(true);
        expect(result.reason).toBe('mediamtx_source_active');
        expect(probeSpy).not.toHaveBeenCalled();
    });

    it('still verifies the UDP trap when sourceReady but bytes are flat (sourceProgressing false)', async () => {
        // Counterpart: a stalled/UDP-bound source reports sourceReady=true but
        // bytesReceived is not growing, so we must still verify via RTSP and
        // report the real (offline) state — bfa8091 behavior preserved.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'internal_stream_unreachable',
            details: {},
        });

        const result = await service.evaluateCameraRaw({
            id: 145,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'flat-145',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.9:554/live',
            enable_recording: 1,
        }, new Map([
            ['flat-145', { configured: true, ready: false, sourceReady: true, readers: 0, bytesReceived: 999, sourceProgressing: false }],
        ]));

        expect(result.online).toBe(false);
        expect(probeSpy).toHaveBeenCalledTimes(1);
    });

    it('getActivePaths reads every page of the paginated MediaMTX API', async () => {
        // RC-A regression: MediaMTX paginates at 100 items/page. Reading only
        // page 0 hides every camera beyond the first 100 → they fall into the
        // fragile RTSP probe and flap offline. getActivePaths must walk all
        // pages and capture bytesReceived for the progressing check.
        const service = new CameraHealthService();
        axios.get.mockImplementation((url, opts) => {
            const page = opts?.params?.page ?? 0;
            const isConfig = url.includes('/config/paths/list');
            const names = page === 0
                ? Array.from({ length: 100 }, (_, i) => `p${i}`)
                : ['p100', 'p101'];
            return Promise.resolve({
                data: {
                    pageCount: 2,
                    items: names.map((name) => (isConfig
                        ? { name }
                        : { name, ready: true, sourceReady: true, readers: [], bytesReceived: 1000 })),
                },
            });
        });

        const paths = await service.getActivePaths();

        expect(paths.size).toBe(102);
        expect(paths.has('p100')).toBe(true);
        expect(paths.get('p100').ready).toBe(true);
        expect(paths.get('p100').bytesReceived).toBe(1000);
        // First sighting with positive bytes counts as progressing.
        expect(paths.get('p100').sourceProgressing).toBe(true);

        axios.get.mockReset();
    });

    it('reuses the per-camera RTSP probe cache within the TTL window', async () => {
        // Probe is expensive; verify the cache works so we don't hammer
        // a dead source every tick.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: true,
            reason: 'rtsp_describe_ok',
            details: {},
        });

        const cameraInput = {
            id: 141,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'cache-141',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.8:554/live',
            enable_recording: 1,
        };
        const activePaths = new Map([
            ['cache-141', { configured: true, ready: false, sourceReady: false, readers: 0 }],
        ]);

        await service.evaluateCameraRaw(cameraInput, activePaths);
        await service.evaluateCameraRaw(cameraInput, activePaths);
        await service.evaluateCameraRaw(cameraInput, activePaths);

        // First call probes; the next two come from cache.
        expect(probeSpy).toHaveBeenCalledTimes(1);
    });

    it('always_on cameras share the RTSP probe between evaluateCameraRaw and evaluateCameraMonitoringStatus (no double DESCRIBE)', async () => {
        // The user pointed out that always_on cameras would otherwise get
        // probed TWICE per tick: once by the non-strict verifier inside
        // evaluateCameraRaw (mediamtx_path_configured_idle path) and again
        // by the strict branch in evaluateCameraMonitoringStatus. Both now
        // route through getOrProbeInternalRtsp which dedupes via the same
        // per-camera cache, so a single tick = a single DESCRIBE.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: true,
            reason: 'rtsp_describe_ok',
            details: {},
        });

        const cameraInput = {
            id: 142,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'always-on-142',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.9:554/live',
            enable_recording: 1,
            // The flag that makes shouldUseStrictInternalMonitoring=true
            // and also keeps MediaMTX trying to hold the source open.
            internal_ingest_policy_override: 'always_on',
        };
        const activePaths = new Map([
            ['always-on-142', { configured: true, ready: false, sourceReady: false, readers: 0 }],
        ]);

        const streamResult = await service.evaluateCameraRaw(cameraInput, activePaths);
        const monitoringResult = await service.evaluateCameraMonitoringStatus(
            cameraInput,
            activePaths,
            { isOnline: streamResult.online ? 1 : 0, rawReason: streamResult.reason }
        );

        // Single network probe across both calls.
        expect(probeSpy).toHaveBeenCalledTimes(1);
        // Strict monitoring uses the probe outcome.
        expect(monitoringResult.isOnline).toBe(1);
        expect(monitoringResult.monitoring_state).toBe('online');
    });

    it('always_on camera with dead source: single probe, strict monitoring sees offline', async () => {
        // The exact scenario the user asked about. Source is dead;
        // MediaMTX keeps trying to reconnect (sourceReady=false). The
        // health system must report offline, and must do it with one
        // RTSP probe per tick, not two.
        const service = new CameraHealthService();
        const probeSpy = vi.spyOn(service, 'probeInternalRtspSource').mockResolvedValue({
            online: false,
            reason: 'internal_stream_unreachable',
            details: {},
        });

        const cameraInput = {
            id: 143,
            enabled: 1,
            is_online: 1,
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            stream_key: 'always-on-dead-143',
            private_rtsp_url: 'rtsp://admin:secret@10.0.0.10:554/live',
            enable_recording: 1,
            internal_ingest_policy_override: 'always_on',
        };
        const activePaths = new Map([
            ['always-on-dead-143', { configured: true, ready: false, sourceReady: false, readers: 0 }],
        ]);

        const streamResult = await service.evaluateCameraRaw(cameraInput, activePaths);
        const monitoringResult = await service.evaluateCameraMonitoringStatus(
            cameraInput,
            activePaths,
            { isOnline: streamResult.online ? 1 : 0, rawReason: streamResult.reason }
        );

        expect(probeSpy).toHaveBeenCalledTimes(1);
        expect(streamResult.online).toBe(false);
        expect(monitoringResult.isOnline).toBe(0);
        expect(monitoringResult.monitoring_state).toBe('offline');
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

    it('triggers recording reconciliation when runtime signal marks a camera online', () => {
        const service = new CameraHealthService();

        service.recordRuntimeSignal(393, {
            targetUrl: 'https://example.test/live.m3u8',
            signalType: 'runtime_success',
            success: true,
            timestamp: Date.now(),
        });

        expect(reconcileCameraLifecycleMock).toHaveBeenCalledWith(393, 'runtime_online_signal');
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

    it('reconciles recording when a camera transitions offline', async () => {
        const service = new CameraHealthService();

        await service.handleCameraStatusTransition(
            { id: 41, enabled: 1, enable_recording: 1 },
            1,
            0,
            'http_404'
        );

        expect(reconcileCameraLifecycleMock).toHaveBeenCalledWith(41, 'health_transition_offline');
        expect(handleCameraBecameOfflineMock).not.toHaveBeenCalled();
        expect(handleCameraBecameOnlineMock).not.toHaveBeenCalled();
        expect(refreshCameraThumbnailMock).not.toHaveBeenCalled();
    });

    it('reconciles recording and refreshes thumbnail when a camera transitions online', async () => {
        const service = new CameraHealthService();

        await service.handleCameraStatusTransition(
            { id: 42, enabled: 1, enable_recording: 1 },
            0,
            1,
            'stream_recovered'
        );

        expect(reconcileCameraLifecycleMock).toHaveBeenCalledWith(42, 'health_transition_online');
        expect(handleCameraBecameOnlineMock).not.toHaveBeenCalled();
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

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [
            expect.objectContaining({
                id: 66,
                name: 'Confirmed Telegram Internal',
                alertDetectedAt: 1_000,
            }),
        ]);
    });

    it('sends Telegram DOWN when monitoring resolves to a non-literal offline state (probe_failed)', async () => {
        // Regression: the confirmation policy only understands online/offline.
        // A monitoring state of probe_failed used to be passed through raw and
        // treated as "unknown" — the offline alert silently never fired.
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = { down: 120_000, up: 60_000 };
        service.telegramAlertState.set(67, {
            confirmedState: 'online',
            pendingTransition: 'offline',
            pendingSince: 1_000,
            lastObservedState: 'offline',
            lastUpdatedAt: 1_000,
        });

        const camera = {
            id: 67,
            name: 'Probe Failed Camera',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'online',
            stream_source: 'external',
            delivery_type: 'external_hls',
            stream_key: 'camera-67',
        };

        vi.spyOn(Date, 'now').mockReturnValue(121_000);
        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 1,
            rawReason: 'stream_online',
            rawDetails: null,
        });
        vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
            camera,
            isOnline: 0,
            monitoring_state: 'probe_failed',
            monitoring_reason: 'probe failed three times',
        });

        queryMock
            .mockReturnValueOnce([{ id: 67, is_online: 1, monitoring_state: 'online' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [
            expect.objectContaining({ id: 67, alertDetectedAt: 1_000 }),
        ]);
    });

    it('restores a persisted pending DOWN after a restart and still sends the alert', async () => {
        // Simulates a backend restart: in-memory telegramAlertState is empty,
        // but the persisted store still holds the in-flight pending DOWN.
        // Without hydration the DOWN alert is silently dropped.
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        getAlertStateMapMock.mockReturnValueOnce(new Map([
            [68, {
                confirmedState: 'online',
                pendingTransition: 'offline',
                pendingSince: 1_000,
                lastObservedState: 'offline',
                lastUpdatedAt: 1_000,
            }],
        ]));

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = { down: 120_000, up: 60_000 };
        // telegramAlertState left empty on purpose — the restart lost it.

        const camera = {
            id: 68,
            name: 'Restarted Camera',
            enabled: 1,
            is_online: 0,
            monitoring_state: 'offline',
            stream_source: 'external',
            delivery_type: 'external_hls',
            stream_key: 'camera-68',
        };

        vi.spyOn(Date, 'now').mockReturnValue(121_000);
        vi.spyOn(service, 'getActivePaths').mockResolvedValue(new Map());
        vi.spyOn(service, 'evaluateCameraStatus').mockResolvedValue({
            camera,
            isOnline: 0,
            rawReason: 'stream_offline',
            rawDetails: null,
        });
        vi.spyOn(service, 'evaluateCameraMonitoringStatus').mockResolvedValue({
            camera,
            isOnline: 0,
            monitoring_state: 'offline',
            monitoring_reason: 'still down',
        });

        queryMock
            .mockReturnValueOnce([{ id: 68, is_online: 0, monitoring_state: 'offline' }])
            .mockReturnValueOnce([camera]);
        executeMock.mockReturnValue({ changes: 1 });
        upsertRuntimeStateMock.mockImplementation(() => {});

        await service.checkAllCameras();

        expect(getAlertStateMapMock).toHaveBeenCalledWith([68]);
        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('offline', [
            expect.objectContaining({ id: 68, alertDetectedAt: 1_000 }),
        ]);
        expect(upsertAlertStatesMock).toHaveBeenCalled();
    });

    it('sends Telegram UP with the original recovery detected time after confirmation', async () => {
        const telegram = await import('../services/telegramService.js');
        telegram.isTelegramConfigured.mockReturnValue(true);

        const service = new CameraHealthService();
        service.telegramAlertConfirmationMs = {
            down: 120_000,
            up: 60_000,
        };
        service.telegramAlertState.set(67, {
            confirmedState: 'offline',
            pendingTransition: 'online',
            pendingSince: 2_000,
            lastObservedState: 'online',
            lastUpdatedAt: 2_000,
        });

        const camera = {
            id: 67,
            name: 'Confirmed Recovery Telegram Internal',
            enabled: 1,
            is_online: 1,
            monitoring_state: 'offline',
            delivery_type: 'internal_hls',
            internal_ingest_policy_override: 'always_on',
            rtsp_url: 'rtsp://example/recovery-confirmed',
        };

        queryMock.mockReturnValueOnce([camera]);
        service.evaluateCameraStatus = vi.fn(async () => ({
            camera,
            isOnline: true,
            rawReason: 'online',
        }));
        service.evaluateCameraMonitoringResult = vi.fn(async () => ({
            monitoringState: 'online',
            monitoringReason: 'rtsp_probe_ok',
        }));
        vi.spyOn(Date, 'now').mockReturnValue(62_000);

        await service.checkAllCameras();

        expect(telegram.sendCameraStatusNotifications).toHaveBeenCalledWith('online', [
            expect.objectContaining({
                id: 67,
                name: 'Confirmed Recovery Telegram Internal',
                alertDetectedAt: 2_000,
            }),
        ]);
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
