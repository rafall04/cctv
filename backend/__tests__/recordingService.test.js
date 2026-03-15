import { EventEmitter } from 'events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();
const execMock = vi.fn();
const existsSyncMock = vi.fn();
const mkdirSyncMock = vi.fn();
const unlinkSyncMock = vi.fn();
const statSyncMock = vi.fn();
const renameSyncMock = vi.fn();
const readdirSyncMock = vi.fn();
const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();
const fsPromisesMock = {
    access: vi.fn(),
    unlink: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    readdir: vi.fn(),
};

vi.mock('child_process', () => ({
    spawn: spawnMock,
    exec: execMock,
}));

vi.mock('fs', () => ({
    existsSync: existsSyncMock,
    mkdirSync: mkdirSyncMock,
    unlinkSync: unlinkSyncMock,
    statSync: statSyncMock,
    renameSync: renameSyncMock,
    readdirSync: readdirSyncMock,
    promises: fsPromisesMock,
}));

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

function createSpawnProcess() {
    const process = new EventEmitter();
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    process.kill = vi.fn();
    return process;
}

function createCamera(overrides = {}) {
    return {
        id: 1,
        name: 'Camera Test',
        stream_source: 'internal',
        private_rtsp_url: 'rtsp://user:pass@10.0.0.2/stream',
        external_hls_url: '',
        enabled: 1,
        enable_recording: 1,
        is_online: 1,
        is_tunnel: 0,
        recording_status: 'recording',
        ...overrides,
    };
}

describe('recordingService external recording support', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();

        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ size: 1024 });
        readdirSyncMock.mockReturnValue([]);
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.unlink.mockResolvedValue(undefined);
        fsPromisesMock.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.now() });
        fsPromisesMock.rename.mockResolvedValue(undefined);
        fsPromisesMock.copyFile.mockResolvedValue(undefined);
        fsPromisesMock.readdir.mockResolvedValue([]);
        execMock.mockImplementation((command, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
            }
            callback?.(null, '', '');
        });
        spawnMock.mockImplementation(() => createSpawnProcess());
        queryMock.mockReturnValue([]);
        executeMock.mockReturnValue(undefined);
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    it('builds RTSP recording args for internal cameras', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: 'C:\\recordings\\camera1',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
        });

        expect(args.slice(0, 4)).toEqual([
            '-rtsp_transport',
            'tcp',
            '-i',
            'rtsp://user:pass@10.0.0.2/stream',
        ]);
        expect(args).toContain('-c:v');
        expect(args).toContain('copy');
        expect(args).toContain('-segment_format');
        expect(args).toContain('mp4');
    });

    it('builds direct HLS recording args for external cameras', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: 'C:\\recordings\\camera2',
            inputUrl: 'https://data.bojonegorokab.go.id/live/local/test/index.m3u8',
            streamSource: 'external',
        });

        expect(args).toContain('-protocol_whitelist');
        expect(args).toContain('file,http,https,tcp,tls,crypto');
        expect(args).toContain('https://data.bojonegorokab.go.id/live/local/test/index.m3u8');
        expect(args).not.toContain('-rtsp_transport');
        expect(args).toContain('-c:v');
        expect(args).toContain('copy');
    });

    it('starts recording external cameras from external_hls_url', async () => {
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue({
            id: 7,
            name: 'Dishub External',
            stream_source: 'external',
            external_hls_url: 'https://data.bojonegorokab.go.id/live/local/test/index.m3u8',
            private_rtsp_url: '',
            enabled: 1,
            enable_recording: 1,
        });

        const result = await recordingService.startRecording(7);

        expect(result).toEqual({ success: true, message: 'Recording started' });
        expect(spawnMock).toHaveBeenCalledTimes(1);

        const [binary, args] = spawnMock.mock.calls[0];
        expect(binary).toBe('ffmpeg');
        expect(args).toContain('https://data.bojonegorokab.go.id/live/local/test/index.m3u8');
        expect(args).not.toContain('-rtsp_transport');
        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET recording_status = ?, last_recording_start = ? WHERE id = ?',
            ['recording', expect.any(String), 7]
        );
    });

    it('rejects external recording when external_hls_url is missing', async () => {
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue({
            id: 9,
            name: 'Broken External',
            stream_source: 'external',
            external_hls_url: '',
            private_rtsp_url: '',
            enabled: 1,
            enable_recording: 1,
        });

        const result = await recordingService.startRecording(9);

        expect(result).toEqual({
            success: false,
            message: 'External HLS URL is required for external recording',
            reason: 'invalid_source',
        });
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('still rejects internal recording when RTSP URL is invalid', async () => {
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue({
            id: 10,
            name: 'Broken Internal',
            stream_source: 'internal',
            external_hls_url: '',
            private_rtsp_url: '',
            enabled: 1,
            enable_recording: 1,
        });

        const result = await recordingService.startRecording(10);

        expect(result).toEqual({
            success: false,
            message: 'Invalid RTSP URL',
            reason: 'invalid_source',
        });
        expect(spawnMock).not.toHaveBeenCalled();
    });

    it('exports deterministic recording cooldown that grows and caps', async () => {
        const { computeRecordingCooldownMs } = await import('../services/recordingService.js');

        expect(computeRecordingCooldownMs(1)).toBe(15000);
        expect(computeRecordingCooldownMs(2)).toBe(30000);
        expect(computeRecordingCooldownMs(3)).toBe(60000);
        expect(computeRecordingCooldownMs(10)).toBe(300000);
    });

    it('restarts a frozen recording when the camera is still online', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({ id: 11 });

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT * FROM cameras')) {
                return camera;
            }
            if (sql.includes('SELECT is_tunnel, is_online, enabled, enable_recording, recording_status')) {
                return {
                    is_tunnel: 0,
                    is_online: 1,
                    enabled: 1,
                    enable_recording: 1,
                    recording_status: 'recording',
                };
            }
            return null;
        });

        await recordingService.startRecording(11);
        vi.advanceTimersByTime(31000);

        const restartSpy = vi.spyOn(recordingService, 'restartRecording').mockResolvedValue({
            success: true,
            message: 'Recording restarted',
        });

        await recordingService.tickHealthMonitoring(Date.now());

        expect(restartSpy).toHaveBeenCalledWith(11, 'stream_frozen');
        expect(recordingService.getRecordingStatus(11).restartCount).toBe(1);
    });

    it('suspends recovery instead of restarting when the camera is confirmed offline', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({ id: 12 });

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT * FROM cameras')) {
                return camera;
            }
            if (sql.includes('SELECT is_tunnel, is_online, enabled, enable_recording, recording_status')) {
                return {
                    is_tunnel: 0,
                    is_online: 0,
                    enabled: 1,
                    enable_recording: 1,
                    recording_status: 'recording',
                };
            }
            return null;
        });

        await recordingService.startRecording(12);
        vi.advanceTimersByTime(31000);

        const restartSpy = vi.spyOn(recordingService, 'restartRecording');

        await recordingService.tickHealthMonitoring(Date.now());

        expect(restartSpy).not.toHaveBeenCalled();
        expect(recordingService.getRecordingStatus(12)).toMatchObject({
            isRecording: false,
            status: 'suspended_offline',
            suspendedReason: 'camera_offline',
        });
    });

    it('keeps waiting during cooldown and only retries recovery once the camera is back online', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({ id: 13 });
        let onlineState = 0;

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT * FROM cameras')) {
                return camera;
            }
            if (sql.includes('SELECT is_tunnel, is_online, enabled, enable_recording, recording_status')) {
                return {
                    is_tunnel: 0,
                    is_online: onlineState,
                    enabled: 1,
                    enable_recording: 1,
                    recording_status: 'recording',
                };
            }
            return null;
        });

        await recordingService.startRecording(13);
        vi.advanceTimersByTime(31000);
        await recordingService.tickHealthMonitoring(Date.now());

        expect(recordingService.getRecordingStatus(13).status).toBe('suspended_offline');

        onlineState = 1;
        const recoverySpy = vi.spyOn(recordingService, 'attemptRecordingRecovery');

        await recordingService.tickHealthMonitoring(Date.now() + 1000);
        expect(recoverySpy).not.toHaveBeenCalled();

        await recordingService.tickHealthMonitoring(Date.now() + 61000);
        expect(recoverySpy).toHaveBeenCalledTimes(1);
    });
});
