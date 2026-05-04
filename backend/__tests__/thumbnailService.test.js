/*
Purpose: Regression coverage for thumbnail source selection and FFmpeg argument construction.
Caller: Vitest backend suite.
Deps: Mocked child_process, filesystem, database, and backend config.
MainFuncs: thumbnailService.generateSingle(), generateAllThumbnails(), buildFfmpegInputArgs().
SideEffects: No real ffmpeg, filesystem, or database writes; all external dependencies are mocked.
*/

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
const execFileMock = vi.fn();
const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();
const copyFileSyncMock = vi.fn();
const executeMock = vi.fn();
const queryMock = vi.fn();

vi.mock('child_process', () => ({
    exec: execMock,
    execFile: execFileMock,
}));

vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    unlinkSync: unlinkSyncMock,
    copyFileSync: copyFileSyncMock,
}));

vi.mock('../database/database.js', () => ({
    query: queryMock,
    execute: executeMock,
}));

vi.mock('../config/config.js', () => ({
    config: {
        mediamtx: {
            hlsUrlInternal: 'http://localhost:8888',
        },
    },
}));

describe('thumbnailService external thumbnails', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();

        existsSyncMock.mockReturnValue(true);
        execMock.mockImplementation((command, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
            }
            callback?.(null, 'ffmpeg version test', '');
        });
        execFileMock.mockImplementation((file, args, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
            }
            callback?.(null, '', '');
        });
    });

    it('executes ffmpeg without shell interpolation for external HLS thumbnails', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const result = await thumbnailService.generateSingle(
            18,
            null,
            'external',
            'https://data.bojonegorokab.go.id/live/local/test/index.m3u8',
            'external_hls'
        );

        expect(result).toEqual({ success: true, source: 'external_hls' });
        expect(execFileMock).toHaveBeenCalledTimes(1);

        const [binary, args] = execFileMock.mock.calls[0];
        expect(binary).toBe('ffmpeg');
        expect(args).toContain('-vf');
        expect(args).toContain('scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2');
        expect(args).toContain('https://data.bojonegorokab.go.id/live/local/test/index.m3u8');
        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET thumbnail_path = ?, thumbnail_updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            ['/api/thumbnails/18.jpg', 18]
        );
    });

    it('uses RTSP-compatible timeout args without rw_timeout for internal RTSP thumbnails', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const args = thumbnailService.buildFfmpegInputArgs('rtsp://admin:secret@192.168.14.2:554/stream1');

        expect(args).toEqual([
            '-rtsp_transport',
            'tcp',
            '-stimeout',
            '10000000',
            '-i',
            'rtsp://admin:secret@192.168.14.2:554/stream1',
        ]);
        expect(args).not.toContain('-rw_timeout');
    });

    it('uses UDP RTSP transport for thumbnail inputs when configured', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const args = thumbnailService.buildFfmpegInputArgs('rtsp://admin:secret@192.168.14.2:554/stream1', 'strict', 'udp');

        expect(args).toEqual([
            '-rtsp_transport',
            'udp',
            '-stimeout',
            '10000000',
            '-i',
            'rtsp://admin:secret@192.168.14.2:554/stream1',
        ]);
    });

    it('omits forced RTSP transport for auto thumbnail inputs', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const args = thumbnailService.buildFfmpegInputArgs('rtsp://admin:secret@192.168.14.2:554/stream1', 'strict', 'auto');

        expect(args).toEqual([
            '-stimeout',
            '10000000',
            '-i',
            'rtsp://admin:secret@192.168.14.2:554/stream1',
        ]);
    });

    it('keeps rw_timeout for HTTP and HLS thumbnail inputs', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const args = thumbnailService.buildFfmpegInputArgs('https://example.com/live/index.m3u8');

        expect(args).toEqual([
            '-rw_timeout',
            '10000000',
            '-i',
            'https://example.com/live/index.m3u8',
        ]);
    });

    it('captures MJPEG thumbnails from snapshot url when available', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const result = await thumbnailService.generateSingle(
            19,
            null,
            'external',
            null,
            'external_mjpeg',
            'https://cctv.jombangkab.go.id/zm/cgi-bin/nph-zms?monitor=112',
            'https://cctv.jombangkab.go.id/snapshot/112.jpg'
        );

        expect(result).toEqual({ success: true, source: 'external_snapshot' });
        const [, args] = execFileMock.mock.calls[0];
        expect(args).toContain('https://cctv.jombangkab.go.id/snapshot/112.jpg');
    });

    it('falls back to placeholder thumbnails for external embed without snapshot', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const result = await thumbnailService.generateSingle(
            20,
            null,
            'external',
            null,
            'external_embed',
            null,
            null
        );

        expect(result).toEqual({ success: true, source: 'placeholder' });
        const [, args] = execFileMock.mock.calls[0];
        expect(args).toContain('lavfi');
        expect(args.some((arg) => String(arg).includes('color='))).toBe(true);
    });

    it('skips offline cameras during background generation', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        queryMock.mockReturnValue([
            {
                id: 21,
                name: 'Online Camera',
                is_online: 1,
                stream_key: 'camera21',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                external_hls_url: null,
                external_stream_url: null,
                external_snapshot_url: null,
                external_embed_url: null,
                external_tls_mode: 'strict',
                thumbnail_path: null,
            },
        ]);

        await thumbnailService.generateAllThumbnails();

        expect(execFileMock).toHaveBeenCalledTimes(1);
        expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('WHERE c.enabled = 1'));
    });

    it('skips strict on-demand Surabaya RTSP cameras during background generation', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        queryMock.mockReturnValue([
            {
                id: 22,
                name: 'Surabaya Camera',
                description: 'source_tag: surabaya_private_rtsp',
                enabled: 1,
                status: 'active',
                is_online: 1,
                runtime_is_online: 1,
                enable_recording: 0,
                stream_key: 'camera22',
                stream_source: 'internal',
                delivery_type: 'internal_hls',
                private_rtsp_url: 'rtsp://user:pass@36.66.208.112:554/Streaming/Channels/402',
                external_hls_url: null,
                external_stream_url: null,
                external_snapshot_url: null,
                external_embed_url: null,
                external_tls_mode: 'strict',
                thumbnail_path: null,
            },
        ]);

        await thumbnailService.generateAllThumbnails();

        expect(execFileMock).not.toHaveBeenCalled();
    });

    it('refreshes a single camera only when it is eligible and online', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        queryMock.mockImplementation((sql, params) => {
            if (params?.[0] === 31) {
                return [{
                    id: 31,
                    name: 'Recovered Camera',
                    enabled: 1,
                    is_online: 1,
                    stream_key: 'camera31',
                    stream_source: 'internal',
                    delivery_type: 'internal_hls',
                    external_hls_url: null,
                    external_stream_url: null,
                    external_snapshot_url: null,
                    external_embed_url: null,
                    external_tls_mode: 'strict',
                    thumbnail_path: null,
                }];
            }

            if (params?.[0] === 32) {
                return [{
                    id: 32,
                    name: 'Offline Camera',
                    enabled: 1,
                    is_online: 0,
                    status: 'active',
                    stream_key: 'camera32',
                    stream_source: 'external',
                    delivery_type: 'external_hls',
                    private_rtsp_url: null,
                    external_hls_url: 'https://example.com/offline/index.m3u8',
                    external_stream_url: 'https://example.com/offline/index.m3u8',
                    external_snapshot_url: null,
                    external_embed_url: null,
                    external_tls_mode: 'strict',
                    thumbnail_path: null,
                }];
            }

            return [];
        });

        const onlineResult = await thumbnailService.refreshCameraThumbnail(31);
        const offlineResult = await thumbnailService.refreshCameraThumbnail(32);

        expect(onlineResult).toEqual({ success: true });
        expect(offlineResult).toEqual({ success: false, skipped: true, reason: 'camera_offline' });
        expect(execFileMock).toHaveBeenCalledTimes(1);
    });

    it('uses private RTSP directly for internal thumbnails when available', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        const result = await thumbnailService.generateSingle(
            33,
            'stream-key-33',
            'internal',
            null,
            'internal_hls'
        );

        expect(result).toEqual({ success: true, source: 'internal_hls' });

        const strategy = thumbnailService.resolveCameraThumbnailStrategy({
            id: 33,
            stream_key: 'stream-key-33',
            stream_source: 'internal',
            delivery_type: 'internal_hls',
            private_rtsp_url: 'rtsp://user:pass@36.66.208.112:554/Streaming/Channels/402',
        });

        expect(strategy).toEqual(expect.objectContaining({
            type: 'internal_rtsp',
            sourceUrl: 'rtsp://user:pass@36.66.208.112:554/Streaming/Channels/402',
        }));
    });

    it('still refreshes internal thumbnails even when legacy is_online is 0', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        queryMock.mockImplementation((sql, params) => {
            if (params?.[0] === 34) {
                return [{
                    id: 34,
                    name: 'Surabaya Internal',
                    enabled: 1,
                    status: 'active',
                    is_online: 0,
                    runtime_is_online: 0,
                    stream_key: 'camera34',
                    stream_source: 'internal',
                    delivery_type: 'internal_hls',
                    private_rtsp_url: 'rtsp://user:pass@36.66.208.112:554/Streaming/Channels/402',
                    external_hls_url: null,
                    external_stream_url: null,
                    external_snapshot_url: null,
                    external_embed_url: null,
                    external_tls_mode: 'strict',
                    thumbnail_path: null,
                }];
            }

            return [];
        });

        const result = await thumbnailService.refreshCameraThumbnail(34);

        expect(result).toEqual({ success: true });
        const [, args] = execFileMock.mock.calls[0];
        expect(args).toContain('rtsp://user:pass@36.66.208.112:554/Streaming/Channels/402');
        expect(args).toContain('-rtsp_transport');
    });

    it('uses internal MediaMTX HLS directly for hls_only thumbnail strategy', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        queryMock.mockImplementation((sql, params) => {
            if (params?.[0] === 35) {
                return [{
                    id: 35,
                    name: 'V380 Yoosee',
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    runtime_is_online: 1,
                    stream_key: 'stream-v380',
                    stream_source: 'internal',
                    delivery_type: 'internal_hls',
                    private_rtsp_url: 'rtsp://user:pass@192.168.12.4:554/onvif1',
                    thumbnail_strategy: 'hls_only',
                    external_hls_url: null,
                    external_stream_url: null,
                    external_snapshot_url: null,
                    external_embed_url: null,
                    external_tls_mode: 'strict',
                    thumbnail_path: null,
                }];
            }

            return [];
        });

        const result = await thumbnailService.refreshCameraThumbnail(35);

        expect(result).toEqual({ success: true });
        const [, args] = execFileMock.mock.calls[0];
        expect(args).toContain('http://localhost:8888/stream-v380/index.m3u8');
        expect(args).not.toContain('rtsp://user:pass@192.168.12.4:554/onvif1');
    });

    it('falls back to internal MediaMTX HLS when direct RTSP thumbnail fails and strategy allows fallback', async () => {
        const { default: thumbnailService } = await import('../services/thumbnailService.js');

        execFileMock
            .mockImplementationOnce((file, args, options, callback) => {
                callback?.(new Error('method SETUP failed: 500 Internal Server Error'), '', '');
            })
            .mockImplementationOnce((file, args, options, callback) => {
                callback?.(null, '', '');
            });
        queryMock.mockImplementation((sql, params) => {
            if (params?.[0] === 36) {
                return [{
                    id: 36,
                    name: 'V380 Yoosee Fallback',
                    enabled: 1,
                    status: 'active',
                    is_online: 1,
                    runtime_is_online: 1,
                    stream_key: 'stream-v380-fallback',
                    stream_source: 'internal',
                    delivery_type: 'internal_hls',
                    private_rtsp_url: 'rtsp://user:pass@192.168.12.4:554/onvif1',
                    thumbnail_strategy: 'hls_fallback',
                    external_hls_url: null,
                    external_stream_url: null,
                    external_snapshot_url: null,
                    external_embed_url: null,
                    external_tls_mode: 'strict',
                    thumbnail_path: null,
                }];
            }

            return [];
        });

        const result = await thumbnailService.refreshCameraThumbnail(36);

        expect(result).toEqual({ success: true });
        expect(execFileMock).toHaveBeenCalledTimes(2);
        expect(execFileMock.mock.calls[0][1]).toContain('rtsp://user:pass@192.168.12.4:554/onvif1');
        expect(execFileMock.mock.calls[1][1]).toContain('http://localhost:8888/stream-v380-fallback/index.m3u8');
    });
});
