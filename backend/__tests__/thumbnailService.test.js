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
            'https://data.bojonegorokab.go.id/live/local/test/index.m3u8'
        );

        expect(result).toEqual({ success: true });
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
});
