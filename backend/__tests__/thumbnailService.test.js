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
        expect(queryMock).toHaveBeenCalledWith(expect.stringContaining('WHERE enabled = 1 AND is_online = 1'));
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
                    stream_key: 'camera32',
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

            return [];
        });

        const onlineResult = await thumbnailService.refreshCameraThumbnail(31);
        const offlineResult = await thumbnailService.refreshCameraThumbnail(32);

        expect(onlineResult).toEqual({ success: true });
        expect(offlineResult).toEqual({ success: false, skipped: true, reason: 'camera_offline' });
        expect(execFileMock).toHaveBeenCalledTimes(1);
    });
});
