/**
 * Purpose: Validate recording start preparation (sourceConfig + ffmpegArgs + dirs).
 * Caller: Vitest backend suite.
 * Deps: recordingStarter with mocked fs.mkdirSync via vi.mock('fs').
 * MainFuncs: prepareRecordingStart, getRecordingSourceConfig, buildRecordingFfmpegArgs, maskRecordingSourceForLog.
 * SideEffects: mkdirSync is mocked; no real I/O.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mkdirSyncMock = vi.fn();

vi.mock('fs', async () => {
    const actual = await vi.importActual('fs');
    return {
        ...actual,
        mkdirSync: mkdirSyncMock,
    };
});

describe('recordingStarter.maskRecordingSourceForLog', () => {
    it('redacts userinfo and query params', async () => {
        const { maskRecordingSourceForLog } = await import('../services/recordingStarter.js');
        expect(maskRecordingSourceForLog('rtsp://admin:secret@10.0.0.1/stream'))
            .toBe('rtsp://****:****@10.0.0.1/stream');
        expect(maskRecordingSourceForLog('https://example.com/play.m3u8?token=abc'))
            .toBe('https://example.com/play.m3u8?token=***');
    });

    it('falls back to regex masking when URL parsing fails', async () => {
        const { maskRecordingSourceForLog } = await import('../services/recordingStarter.js');
        expect(maskRecordingSourceForLog('not a url admin:secret@host'))
            .toContain(':****@');
    });

    it('returns empty string for empty input', async () => {
        const { maskRecordingSourceForLog } = await import('../services/recordingStarter.js');
        expect(maskRecordingSourceForLog('')).toBe('');
        expect(maskRecordingSourceForLog(null)).toBe('');
    });
});

describe('recordingStarter.getRecordingSourceConfig', () => {
    it('returns internal config for internal_hls camera with valid RTSP url', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        const config = getRecordingSourceConfig({
            delivery_type: 'internal_hls',
            stream_source: 'internal',
            private_rtsp_url: 'rtsp://user:pw@cam.local/stream',
        });
        expect(config.success).toBe(true);
        expect(config.streamSource).toBe('internal');
        expect(config.inputUrl).toBe('rtsp://user:pw@cam.local/stream');
        expect(config.logSource).not.toContain('pw');
        expect(config.rtspTransport).toBeDefined();
    });

    it('returns external config for external_hls camera with valid URL', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        const config = getRecordingSourceConfig({
            delivery_type: 'external_hls',
            external_hls_url: 'https://example.com/live.m3u8',
        });
        expect(config).toMatchObject({
            success: true,
            streamSource: 'external',
            inputUrl: 'https://example.com/live.m3u8',
        });
    });

    it('rejects external_hls camera missing URL', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        const config = getRecordingSourceConfig({
            delivery_type: 'external_hls',
            external_hls_url: '',
        });
        expect(config).toMatchObject({ success: false, reason: 'invalid_source' });
    });

    it('rejects external_hls camera with non-http(s) URL', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        const config = getRecordingSourceConfig({
            delivery_type: 'external_hls',
            external_hls_url: 'rtsp://bad/url',
        });
        expect(config).toMatchObject({ success: false, reason: 'invalid_source' });
    });

    it('rejects unsupported delivery_type', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        const config = getRecordingSourceConfig({ delivery_type: 'external_mjpeg' });
        expect(config).toMatchObject({ success: false, reason: 'unsupported_source' });
    });

    it('rejects internal_hls camera missing or invalid RTSP URL', async () => {
        const { getRecordingSourceConfig } = await import('../services/recordingStarter.js');
        expect(getRecordingSourceConfig({ delivery_type: 'internal_hls', private_rtsp_url: '' }))
            .toMatchObject({ success: false, reason: 'invalid_source' });
        expect(getRecordingSourceConfig({ delivery_type: 'internal_hls', private_rtsp_url: 'http://not-rtsp' }))
            .toMatchObject({ success: false, reason: 'invalid_source' });
    });
});

describe('recordingStarter.buildRecordingFfmpegArgs', () => {
    it('builds segmented stream-copy args with web-compatible MP4 flags', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingStarter.js');
        const args = buildRecordingFfmpegArgs({
            cameraDir: '/recordings/camera1',
            outputPattern: '/recordings/camera1/pending/%Y%m%d_%H%M%S.mp4.partial',
            inputUrl: 'rtsp://cam/stream',
            streamSource: 'internal',
            rtspTransport: 'tcp',
        });
        expect(args).toContain('-c:v');
        expect(args).toContain('copy');
        expect(args).toContain('-f');
        expect(args).toContain('segment');
        expect(args).toContain('-segment_time');
        expect(args).toContain('600');
        expect(args).toContain('-strftime');

        // The fMP4 flags must reach the INNER mp4 muxer. As a bare top-level
        // `-movflags` the segment muxer drops them silently and every abrupt stop
        // destroys the whole in-flight segment — measured on prod: 48 bytes on disk
        // after 12s and "moov atom not found", versus 236 KB and playable with the
        // option routed correctly. Assert the exact pairing, not just that the flag
        // string appears somewhere: a loose toContain() is what let this ship.
        const optIndex = args.indexOf('-segment_format_options');
        expect(optIndex).toBeGreaterThan(-1);
        expect(args[optIndex + 1]).toBe('movflags=+frag_keyframe+empty_moov+default_base_moof');
        expect(args).not.toContain('-movflags');
        // Internal RTSP recording carries a socket timeout so a stalled camera makes
        // FFmpeg exit instead of hanging (routes through the failure handler).
        expect(args).toContain('-stimeout');
        expect(args.indexOf('-stimeout')).toBeLessThan(args.indexOf('-i'));
        expect(args[args.length - 1]).toBe('/recordings/camera1/pending/%Y%m%d_%H%M%S.mp4.partial');
    });

    /*
     * REGRESSION: FFmpeg ran at its default `info` level, narrating every HLS
     * segment fetch. Relayed into the recorder's stdout that came to 1.4 GB/day of
     * pm2 log on production. `-stats` is what makes the quieter level safe: it
     * forces the progress line out via a direct stderr write instead of av_log, so
     * recordingHealthMonitor's freeze heartbeat survives. Measured on the prod
     * binary: 3,998 -> 244 stderr bytes over 12s, with 3 heartbeats either way.
     */
    it('REGRESSION: quiets FFmpeg but keeps the progress heartbeat', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingStarter.js');
        const args = buildRecordingFfmpegArgs({
            cameraDir: '/recordings/camera1',
            outputPattern: '/r/c1/%Y.mp4',
            inputUrl: 'https://example.com/live.m3u8',
            streamSource: 'external',
        });

        const level = args.indexOf('-loglevel');
        expect(level).toBeGreaterThan(-1);
        expect(args[level + 1]).toBe('error');
        expect(args).toContain('-hide_banner');
        // Without -stats the freeze detector loses its heartbeat and every recorder
        // eventually looks stuck. -nostats must never appear here.
        expect(args).toContain('-stats');
        expect(args).not.toContain('-nostats');
        // Global options must precede the input they apply to.
        expect(level).toBeLessThan(args.indexOf('-i'));
    });

    it('uses protocol whitelist for external streams', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingStarter.js');
        const args = buildRecordingFfmpegArgs({
            cameraDir: '/recordings/camera1',
            outputPattern: '/r/c1/%Y.mp4',
            inputUrl: 'https://example.com/live.m3u8',
            streamSource: 'external',
        });
        expect(args).toContain('-protocol_whitelist');
        expect(args.indexOf('-i')).toBeLessThan(args.indexOf('-c:v'));
    });
});

describe('recordingStarter.prepareRecordingStart', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns success struct with sourceConfig, ffmpegArgs, spawnOptions and creates dirs', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({
            camera: {
                id: 5,
                enabled: 1,
                enable_recording: 1,
                delivery_type: 'internal_hls',
                stream_source: 'internal',
                private_rtsp_url: 'rtsp://cam/stream',
            },
            recordingsBasePath: '/recordings',
        });
        expect(result.success).toBe(true);
        expect(result.sourceConfig.streamSource).toBe('internal');
        expect(result.ffmpegArgs).toContain('copy');
        expect(result.spawnOptions.env).toBeDefined();
        expect(result.spawnOptions.env.TZ).toBeTruthy();
        expect(result.recordingTimezone).toBeTruthy();
        expect(mkdirSyncMock).toHaveBeenCalledTimes(2);
    });

    it('rejects missing camera', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({ camera: null, recordingsBasePath: '/r' });
        expect(result).toEqual({ success: false, message: 'Camera not found' });
    });

    it('rejects disabled camera', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({
            camera: {
                id: 1,
                enabled: 0,
                enable_recording: 1,
                delivery_type: 'internal_hls',
                private_rtsp_url: 'rtsp://cam/s',
            },
            recordingsBasePath: '/r',
        });
        expect(result).toEqual({ success: false, message: 'Camera is disabled' });
    });

    it('rejects camera with recording disabled', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({
            camera: {
                id: 1,
                enabled: 1,
                enable_recording: 0,
                delivery_type: 'internal_hls',
                private_rtsp_url: 'rtsp://cam/s',
            },
            recordingsBasePath: '/r',
        });
        expect(result).toEqual({ success: false, message: 'Recording not enabled for this camera' });
    });

    it('rejects camera with invalid source (forwards reason)', async () => {
        const { prepareRecordingStart } = await import('../services/recordingStarter.js');
        const result = prepareRecordingStart({
            camera: {
                id: 1,
                enabled: 1,
                enable_recording: 1,
                delivery_type: 'internal_hls',
                private_rtsp_url: '',
            },
            recordingsBasePath: '/r',
        });
        expect(result.success).toBe(false);
        expect(result.reason).toBe('invalid_source');
    });
});
