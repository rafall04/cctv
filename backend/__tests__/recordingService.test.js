/**
 * Purpose: Validate recording source selection, lifecycle recovery, and cleanup safety guards.
 * Caller: Vitest backend test suite.
 * Deps: mocked child_process, fs, and database connection pool.
 * MainFuncs: recordingService cleanup and process lifecycle tests.
 * SideEffects: Uses fake timers and module mocks; no real filesystem or database writes.
 */
import { EventEmitter } from 'events';
import { join } from 'path';
import { promisify } from 'util';
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
    mkdir: vi.fn(),
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
        delete execMock[promisify.custom];

        existsSyncMock.mockReturnValue(true);
        statSyncMock.mockReturnValue({ size: 1024 });
        readdirSyncMock.mockReturnValue([]);
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.unlink.mockResolvedValue(undefined);
        fsPromisesMock.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.now() });
        fsPromisesMock.rename.mockResolvedValue(undefined);
        fsPromisesMock.copyFile.mockResolvedValue(undefined);
        fsPromisesMock.readdir.mockResolvedValue([]);
        fsPromisesMock.mkdir.mockResolvedValue(undefined);
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
        vi.restoreAllMocks();
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

    it('builds UDP RTSP recording args for cameras that require UDP transport', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: 'C:\\recordings\\camera1',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
            rtspTransport: 'udp',
        });

        expect(args.slice(0, 4)).toEqual([
            '-rtsp_transport',
            'udp',
            '-i',
            'rtsp://user:pass@10.0.0.2/stream',
        ]);
    });

    it('omits fixed RTSP transport for auto recording mode', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: 'C:\\recordings\\camera1',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
            rtspTransport: 'auto',
        });

        expect(args.slice(0, 2)).toEqual([
            '-i',
            'rtsp://user:pass@10.0.0.2/stream',
        ]);
        expect(args).not.toContain('-rtsp_transport');
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

    it('builds recording args with pending partial output pattern', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            outputPattern: 'C:\\recordings\\camera1\\pending\\%Y%m%d_%H%M%S.mp4.partial',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
        });

        expect(args.at(-1)).toBe('C:\\recordings\\camera1\\pending\\%Y%m%d_%H%M%S.mp4.partial');
        expect(args).toContain('-segment_format');
        expect(args).toContain('mp4');
    });

    it('creates pending recording directory before starting recording', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');
        queryOneMock.mockReturnValue(createCamera({ id: 33 }));

        await recordingService.startRecording(33);

        expect(mkdirSyncMock).toHaveBeenCalledWith(join(recordingsBasePath, 'camera33', 'pending'), { recursive: true });
        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            join(recordingsBasePath, 'camera33', 'pending', '%Y%m%d_%H%M%S.mp4.partial'),
        ]));
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
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        expect(errorSpy).toHaveBeenCalledWith('[Recording] Invalid source for camera 9: External HLS URL is required for external recording');
    });

    it('still rejects internal recording when RTSP URL is invalid', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
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
        expect(errorSpy).toHaveBeenCalledWith('[Recording] Invalid source for camera 10: Invalid RTSP URL');
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
        const child = spawnMock.mock.results.at(-1).value;
        vi.advanceTimersByTime(31000);

        const restartSpy = vi.spyOn(recordingService, 'restartRecording');

        const tickPromise = recordingService.tickHealthMonitoring(Date.now());
        child.emit('close', 255, null);
        await tickPromise;

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
        const child = spawnMock.mock.results.at(-1).value;
        vi.advanceTimersByTime(31000);
        const offlineTickPromise = recordingService.tickHealthMonitoring(Date.now());
        child.emit('close', 255, null);
        await offlineTickPromise;

        expect(recordingService.getRecordingStatus(13).status).toBe('suspended_offline');

        onlineState = 1;
        const recoverySpy = vi.spyOn(recordingService, 'attemptRecordingRecovery');

        await recordingService.tickHealthMonitoring(Date.now() + 1000);
        expect(recoverySpy).not.toHaveBeenCalled();

        await recordingService.tickHealthMonitoring(Date.now() + 61000);
        expect(recoverySpy).toHaveBeenCalledTimes(1);
    });

    it('suspends an active recording immediately when the health service marks it offline', async () => {
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue(createCamera({ id: 14 }));

        await recordingService.startRecording(14);
        const child = spawnMock.mock.results.at(-1).value;
        const offlinePromise = recordingService.handleCameraBecameOffline(14);
        child.emit('close', 255, null);
        const status = await offlinePromise;

        expect(status).toMatchObject({
            isRecording: false,
            status: 'suspended_offline',
            suspendedReason: 'camera_offline',
        });
    });

    it('tries to resume recording immediately when the health service marks it online again', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({ id: 15 });

        queryOneMock.mockReturnValue(camera);

        await recordingService.handleCameraBecameOffline(15);
        const result = await recordingService.handleCameraBecameOnline(15);

        expect(result).toMatchObject({ success: true, message: 'Recording started' });
        expect(recordingService.getRecordingStatus(15)).toMatchObject({
            isRecording: true,
            status: 'recording',
        });
    });

    it('does not mark intentional stop exit as ffmpeg_failed', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        child.pid = 707;
        spawnMock.mockReturnValue(child);
        queryOneMock.mockReturnValue(createCamera({ id: 70 }));

        await recordingService.startRecording(70);
        const stopPromise = recordingService.stopRecording(70);

        expect(child.kill).toHaveBeenCalledWith('SIGINT');
        child.emit('close', 255, null);

        await expect(stopPromise).resolves.toMatchObject({ success: true });
        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE cameras SET recording_status = ? WHERE id = ?',
            ['stopped', 70]
        );
        expect(executeMock.mock.calls.some(([sql]) => String(sql).includes('recording_restart_logs'))).toBe(false);
    });

    it('stops all active recordings during service shutdown', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const first = createSpawnProcess();
        const second = createSpawnProcess();
        first.pid = 801;
        second.pid = 802;
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        queryOneMock.mockImplementation((sql, params) => createCamera({ id: params?.[0] ?? 1 }));

        await recordingService.startRecording(81);
        await recordingService.startRecording(82);

        const shutdownPromise = recordingService.shutdown();
        expect(first.kill).toHaveBeenCalledWith('SIGINT');
        expect(second.kill).toHaveBeenCalledWith('SIGINT');

        first.emit('close', 255, null);
        second.emit('close', 255, null);

        await expect(shutdownPromise).resolves.toHaveLength(2);
    });

    it('refuses cleanup delete when DB file path escapes the recording directory', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { join } = await import('path');
        const { recordingService } = await import('../services/recordingService.js');
        const oldStart = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();

        queryOneMock.mockReturnValue({ recording_duration_hours: 1, name: 'Guarded Camera' });
        queryMock.mockImplementation((sql) => {
            if (sql.includes('FROM recording_segments') && sql.includes('start_time <')) {
                return [{
                    id: 501,
                    camera_id: 1,
                    start_time: oldStart,
                    filename: '20260502_000000.mp4',
                    file_path: join(process.cwd(), 'outside-recordings', '20260502_000000.mp4'),
                }];
            }

            if (sql.includes('SELECT filename FROM recording_segments')) {
                return [];
            }

            return [];
        });

        await recordingService.cleanupOldSegments(1);

        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('outside-recordings'));
        expect(executeMock).not.toHaveBeenCalledWith('DELETE FROM recording_segments WHERE id = ?', [501]);
        expect(warnSpy).toHaveBeenCalledWith('[Cleanup] Refusing unsafe delete for camera1/20260502_000000.mp4 (retention_expired)');
    });

    it('deletes only oldest expired DB segments in a bounded normal cleanup batch', async () => {
        const { join } = await import('path');
        const { recordingService } = await import('../services/recordingService.js');
        const oldStart = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');

        queryOneMock.mockReturnValue({ recording_duration_hours: 1, name: 'Bounded Camera' });
        queryMock.mockImplementation((sql) => {
            if (sql.includes('FROM recording_segments') && sql.includes('start_time <')) {
                return Array.from({ length: 6 }, (_, index) => ({
                    id: 600 + index,
                    camera_id: 1,
                    start_time: oldStart,
                    filename: `20260502_00000${index}.mp4`,
                    file_path: join(recordingsBasePath, 'camera1', `20260502_00000${index}.mp4`),
                }));
            }

            if (sql.includes('SELECT filename FROM recording_segments')) {
                return [];
            }

            return [];
        });

        await recordingService.cleanupOldSegments(1);

        expect(fsPromisesMock.unlink).toHaveBeenCalledTimes(6);
        expect(executeMock.mock.calls.filter(([sql]) => sql === 'DELETE FROM recording_segments WHERE id = ?')).toHaveLength(6);
    });

    it('keeps recent DB segments while deleting only expired old segments', async () => {
        const { join } = await import('path');
        const { recordingService } = await import('../services/recordingService.js');
        const oldStart = new Date(Date.now() - (2 * 60 * 60 * 1000)).toISOString();
        const recentStart = new Date(Date.now() - (20 * 60 * 1000)).toISOString();
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');
        const oldPath = join(recordingsBasePath, 'camera1', '20260502_000000.mp4');
        const recentPath = join(recordingsBasePath, 'camera1', '20260502_010000.mp4');

        queryOneMock.mockReturnValue({ recording_duration_hours: 1, name: 'Mixed Retention Camera' });
        queryMock.mockImplementation((sql) => {
            if (sql.includes('FROM recording_segments') && sql.includes('start_time <')) {
                return [
                    {
                        id: 701,
                        camera_id: 1,
                        start_time: oldStart,
                        filename: '20260502_000000.mp4',
                        file_path: oldPath,
                    },
                ];
            }

            if (sql.includes('SELECT filename FROM recording_segments')) {
                return [];
            }

            return [];
        });

        await recordingService.cleanupOldSegments(1);

        expect(fsPromisesMock.unlink).toHaveBeenCalledWith(oldPath);
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(recentPath);
        expect(executeMock).toHaveBeenCalledWith('DELETE FROM recording_segments WHERE id = ?', [701]);
        expect(executeMock).not.toHaveBeenCalledWith('DELETE FROM recording_segments WHERE id = ?', [702]);
    });

    it('quarantines invalid short segments instead of deleting them immediately', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { join } = await import('path');
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '0.2\n', stderr: '' }));
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT fail_count FROM failed_remux_files')) {
                return null;
            }
            if (sql.includes('SELECT recording_duration_hours FROM cameras')) {
                return { recording_duration_hours: 1 };
            }
            return null;
        });
        fsPromisesMock.stat.mockResolvedValue({
            size: 1024,
            mtimeMs: Date.parse('2026-05-02T00:01:00.000Z'),
        });
        execMock.mockImplementation((command, options, callback) => {
            if (typeof options === 'function') {
                callback = options;
            }
            callback?.(null, '0.2\n', '');
        });
        spawnMock.mockReturnValue(child);

        recordingService.onSegmentCreated(3, '20260502_000000.mp4');
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.resolve();

        expect(fsPromisesMock.mkdir).toHaveBeenCalled();
        expect(fsPromisesMock.rename).toHaveBeenCalledWith(
            join(recordingsBasePath, 'camera3', '20260502_000000.mp4'),
            expect.stringContaining('.quarantine')
        );
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(join(recordingsBasePath, 'camera3', '20260502_000000.mp4'));
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[Segment] Quarantined file: camera3/20260502_000000.mp4 -> .quarantine/camera3/'));
    });

    it('does not emergency-delete recent filesystem orphan recordings', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '100\n', stderr: '' }));
        const { recordingService } = await import('../services/recordingService.js');
        queryMock.mockReturnValue([]);
        queryOneMock.mockReturnValue({ recording_duration_hours: 5 });
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (String(targetPath).endsWith('recordings')) return ['camera7'];
            return ['20260502_095800.mp4'];
        });
        fsPromisesMock.stat.mockResolvedValue({
            isDirectory: () => true,
            mtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
            size: 4096,
        });

        await recordingService.emergencyDiskSpaceCheck();

        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_095800.mp4'));
        expect(warnSpy).toHaveBeenCalledWith('[DiskCheck] ⚠️ LOW DISK SPACE: 0.00GB free. Starting emergency cleanup...');
    });

    it('keeps short unstable-connection segments until retention expiry', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { join } = await import('path');
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '0.2\n', stderr: '' }));
        const { recordingService } = await import('../services/recordingService.js');
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT fail_count FROM failed_remux_files')) return null;
            if (sql.includes('SELECT recording_duration_hours FROM cameras')) return { recording_duration_hours: 5 };
            return null;
        });
        fsPromisesMock.stat.mockResolvedValue({
            size: 1024,
            mtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
        });

        recordingService.onSegmentCreated(3, '20260502_095800.mp4');
        await vi.advanceTimersByTimeAsync(3000);
        await Promise.resolve();

        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(join(recordingsBasePath, 'camera3', '20260502_095800.mp4'));
        expect(fsPromisesMock.rename).not.toHaveBeenCalledWith(
            join(recordingsBasePath, 'camera3', '20260502_095800.mp4'),
            expect.stringContaining('.quarantine')
        );
        expect(warnSpy).toHaveBeenCalledWith('[Segment] Keeping invalid segment until retention expiry: camera3/20260502_095800.mp4');
    });

    it('keeps recent failed-remux segments in place until retention expiry', async () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { join } = await import('path');
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        const { recordingService } = await import('../services/recordingService.js');
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT fail_count FROM failed_remux_files')) return { fail_count: 3 };
            if (sql.includes('SELECT recording_duration_hours FROM cameras')) return { recording_duration_hours: 5 };
            return null;
        });
        fsPromisesMock.stat.mockResolvedValue({
            size: 512,
            mtimeMs: Date.parse('2026-05-02T09:59:30.000Z'),
        });
        executeMock.mockClear();

        recordingService.onSegmentCreated(3, '20260502_095800.mp4');
        await Promise.resolve();
        await Promise.resolve();

        expect(fsPromisesMock.rename).not.toHaveBeenCalledWith(
            join(recordingsBasePath, 'camera3', '20260502_095800.mp4'),
            expect.stringContaining('.quarantine')
        );
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(join(recordingsBasePath, 'camera3', '20260502_095800.mp4'));
        expect(executeMock).not.toHaveBeenCalledWith(
            'DELETE FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
            [3, '20260502_095800.mp4']
        );
        expect(warnSpy).toHaveBeenCalledWith('[Segment] Keeping failed remux segment until retention expiry: camera3/20260502_095800.mp4');
    });

    it('registers the same segment idempotently when scanner and ffmpeg close detect it together', async () => {
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '12\n', stderr: '' }));
        const repository = (await import('../services/recordingSegmentRepository.js')).default;
        const upsertSpy = vi.spyOn(repository, 'upsertSegment').mockReturnValue({ changes: 1 });
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT fail_count FROM failed_remux_files')) {
                return null;
            }

            return null;
        });
        fsPromisesMock.stat.mockResolvedValue({
            size: 4096,
            mtimeMs: Date.now(),
        });
        spawnMock.mockImplementation(() => {
            const child = createSpawnProcess();
            setTimeout(() => child.emit('close', 0), 0);
            return child;
        });

        recordingService.onSegmentCreated(5, '20260503_020000.mp4');
        recordingService.onSegmentCreated(5, '20260503_020000.mp4');

        await vi.advanceTimersByTimeAsync(3001);
        await Promise.resolve();

        expect(upsertSpy).toHaveBeenCalledTimes(1);
    });

    it('starts and stops the attached recording scheduler explicitly', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const scheduler = {
            start: vi.fn(),
            stop: vi.fn(),
        };

        recordingService.attachScheduler(scheduler);
        recordingService.initializeBackgroundWork();
        await recordingService.shutdown();

        expect(scheduler.start).toHaveBeenCalledTimes(1);
        expect(scheduler.stop).toHaveBeenCalledTimes(1);
    });
});
