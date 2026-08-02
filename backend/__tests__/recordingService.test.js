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
const finalizerMock = {
    finalizeSegment: vi.fn(),
    drain: vi.fn(),
};
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

vi.mock('../services/recordingSegmentFinalizer.js', () => ({
    default: finalizerMock,
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
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        finalizerMock.drain.mockResolvedValue({ drained: true, pending: 0 });
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

        // The invariant is ordering, not position: -rtsp_transport is an INPUT
        // option, so it only takes effect if FFmpeg sees it before -i. (It used to
        // be asserted at index 0, which also silently pinned "no global options
        // may precede it" — an unrelated constraint that broke the moment
        // -loglevel was added.)
        const transportIndex = args.indexOf('-rtsp_transport');
        expect(transportIndex).toBeGreaterThan(-1);
        expect(args[transportIndex + 1]).toBe('tcp');
        expect(transportIndex).toBeLessThan(args.indexOf('-i'));
        expect(args).toContain('-stimeout'); // socket timeout so a stalled camera exits
        expect(args.indexOf('-stimeout')).toBeLessThan(args.indexOf('-i'));
        expect(args[args.indexOf('-i') + 1]).toBe('rtsp://user:pass@10.0.0.2/stream');
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

        const transportIndex = args.indexOf('-rtsp_transport');
        expect(transportIndex).toBeGreaterThan(-1);
        expect(args[transportIndex + 1]).toBe('udp');
        expect(transportIndex).toBeLessThan(args.indexOf('-i'));
        expect(args[args.indexOf('-i') + 1]).toBe('rtsp://user:pass@10.0.0.2/stream');
    });

    it('omits fixed RTSP transport for auto recording mode', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            cameraDir: 'C:\\recordings\\camera1',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
            rtspTransport: 'auto',
        });

        expect(args).not.toContain('-rtsp_transport');
        expect(args[args.indexOf('-i') + 1]).toBe('rtsp://user:pass@10.0.0.2/stream');
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
        expect(spawnMock).toHaveBeenCalledWith(
            'ffmpeg',
            expect.arrayContaining([
                join(recordingsBasePath, 'camera33', 'pending', '%Y%m%d_%H%M%S.mp4.partial'),
            ]),
            expect.objectContaining({
                env: expect.objectContaining({ TZ: 'Asia/Jakarta' }),
            })
        );
    });

    it('delegates partial segment closing to the finalizer', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');

        recordingService.handleRecordingStderr(
            5,
            "Opening 'C:\\recordings\\camera5\\pending\\20260511_211000.mp4.partial' for writing\nClosing segment"
        );

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 5,
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        }));
    });

    /*
     * REGRESSION (production: 2.9 GB of pm2 log in 2.5 days, ~1.4 GB/day).
     *
     * The stderr tailer delivers a CHUNK — every byte that arrived since its last
     * poll — not a line. handleRecordingStderr classified that whole chunk as if
     * it were one line and printed all of it under a single prefix, so FFmpeg's
     * info-level chatter rode into the log on the back of one matching line. In a
     * 200,000-line prod sample only 326 lines carried a prefix; 162,920 were raw
     * FFmpeg text dragged along with them. That log shares a filesystem with the
     * recordings, and the emergency disk guard reclaims space by DELETING
     * recordings — so log growth was on a path to destroying footage.
     */
    it('REGRESSION: a chunk of FFmpeg chatter produces no stdout at all', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

        recordingService.handleRecordingStderr(7, [
            "[https @ 0x55] Opening 'https://example.test/live/out.m3u8' for reading",
            "[hls @ 0x55] Skip ('#EXT-X-VERSION:3')",
            "[hls @ 0x55] Skip ('#EXT-X-PROGRAM-DATE-TIME:2026-08-02T17:09:47.523+0000')",
            "[https @ 0x55] Opening 'https://example.test/live/out_199802.ts' for reading",
            'frame=5542169 fps= 25 q=-1.0 size=N/A time=61:34:58.62 bitrate=N/A speed=   1x',
        ].join('\n'));

        expect(logSpy).not.toHaveBeenCalled();
        logSpy.mockRestore();
    });

    it('REGRESSION: an error line inside a noisy chunk is still reported, once', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        recordingService.handleRecordingStderr(7, [
            "[hls @ 0x55] Skip ('#EXT-X-VERSION:3')",
            'https://example.test/live/out.m3u8: Server returned 404 Not Found error',
            "[hls @ 0x55] Skip ('#EXT-X-VERSION:3')",
        ].join('\n'));

        expect(errorSpy).toHaveBeenCalledTimes(1);
        expect(errorSpy.mock.calls[0][0]).toContain('404 Not Found');
        // The surrounding noise must NOT be dragged into the error line.
        expect(errorSpy.mock.calls[0][0]).not.toContain('EXT-X-VERSION');
        errorSpy.mockRestore();
    });

    /*
     * REGRESSION (production: 189 plaintext camera passwords in the recorder log).
     * The backend masks its own RTSP sources, so this was invisible there — but the
     * recorder echoes FFmpeg's raw stderr, which quotes the input URL verbatim.
     */
    it('REGRESSION: FFmpeg error lines never leak RTSP credentials', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        recordingService.handleRecordingStderr(
            7,
            'rtsp://admin:SuperSecret123@10.0.0.4:554/stream1: Connection timed out error'
        );

        expect(errorSpy).toHaveBeenCalledTimes(1);
        const logged = errorSpy.mock.calls[0][0];
        expect(logged).not.toContain('SuperSecret123');
        expect(logged).not.toContain('admin');
        // Host, port and the actual failure stay readable — that is what makes it diagnosable.
        expect(logged).toContain('10.0.0.4:554');
        expect(logged).toContain('Connection timed out');
        errorSpy.mockRestore();
    });

    it('delegates segment recovery through the recovery queue facade', async () => {
        const recoveryModule = await import('../services/recordingRecoveryService.js');
        const recoverSpy = vi.spyOn(recoveryModule.default, 'enqueueRecovery')
            .mockResolvedValue({ success: true, finalFilename: '20260511_211000.mp4' });
        const { recordingService } = await import('../services/recordingService.js');

        recordingService.onSegmentCreated(5, '20260511_211000.mp4.partial');
        await Promise.resolve();

        expect(recoverSpy).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 5,
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        }));
    });

    it('keeps duplicate partial close events idempotent through finalizer delegation', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');

        recordingService.onSegmentCreated(5, '20260511_211000.mp4.partial');
        recordingService.onSegmentCreated(5, '20260511_211000.mp4.partial');

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledTimes(1);
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
        const recoverySpy = vi.spyOn(recordingService.healthMonitor, 'attemptRecovery');

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

    it('periodic lifecycle reconciliation starts a stopped online camera missing from stream health state', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({
            id: 91,
            delivery_type: 'internal_hls',
            is_online: 1,
            enable_recording: 1,
            enabled: 1,
        });

        queryMock.mockReturnValue([camera]);
        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT id, enabled, enable_recording, is_online, delivery_type')) {
                return camera;
            }
            if (sql.includes('SELECT * FROM cameras')) {
                return camera;
            }
            return null;
        });

        expect(recordingService.getRecordingStatus(91)).toMatchObject({ status: 'stopped' });

        const result = await recordingService.reconcileRecordingLifecycleAll('test_periodic', 1000);

        expect(result).toMatchObject({ success: true, checked: 1 });
        expect(recordingService.getRecordingStatus(91)).toMatchObject({
            isRecording: true,
            status: 'recording',
        });
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });

    it('starts lifecycle reconciliation through the recording scheduler', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const scheduleTimeout = vi.fn();

        recordingService.startLifecycleReconciler(scheduleTimeout);

        expect(scheduleTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
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

    it('exposes pid/streamSource/adopted in runtime status', async () => {
        // The recording worker publishes this object for the API to read. When these
        // fields were dropped here, the admin surface reported "pid: null, adopted:
        // false" for recorders that had a pid and were adopted.
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        child.pid = 909;
        spawnMock.mockReturnValue(child);
        queryOneMock.mockImplementation((sql, params) => createCamera({ id: params?.[0] ?? 1 }));

        await recordingService.startRecording(90);

        expect(recordingService.getRecordingStatus(90)).toMatchObject({
            isRecording: true,
            pid: 909,
            adopted: false,
        });
        expect(recordingService.getActiveRecordingCameraIds()).toContain(90);
    });

    it('DETACHES active recordings on server shutdown instead of killing them', async () => {
        // The load-bearing guarantee of this change: a backend restart must not
        // interrupt recording. Signalling ffmpeg here is what used to cost an
        // in-flight segment per camera on every single deploy.
        const { recordingService } = await import('../services/recordingService.js');
        const first = createSpawnProcess();
        const second = createSpawnProcess();
        first.pid = 801;
        second.pid = 802;
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        queryOneMock.mockImplementation((sql, params) => createCamera({ id: params?.[0] ?? 1 }));

        await recordingService.startRecording(81);
        await recordingService.startRecording(82);

        const detached = await recordingService.shutdown();

        expect(first.kill).not.toHaveBeenCalled();
        expect(second.kill).not.toHaveBeenCalled();
        expect(detached).toHaveLength(2);
        expect(detached.map((entry) => entry.pid).sort()).toEqual([801, 802]);
    });

    it('still stops recorders when the box itself is going down', async () => {
        // Explicit opt-in: nothing is coming back to adopt them, so a clean SIGINT
        // (segment closes properly) beats leaving orphans behind.
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        child.pid = 803;
        spawnMock.mockReturnValue(child);
        queryOneMock.mockImplementation((sql, params) => createCamera({ id: params?.[0] ?? 1 }));

        await recordingService.startRecording(83);

        const shutdownPromise = recordingService.shutdown({ stopRecorders: true });
        expect(child.kill).toHaveBeenCalledWith('SIGINT');

        child.emit('close', 255, null);
        await expect(shutdownPromise).resolves.toHaveLength(1);
    });

    it('drains segment finalizer during shutdown after stopping ffmpeg', async () => {
        finalizerMock.drain.mockResolvedValue({ drained: true, pending: 0 });
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        spawnMock.mockReturnValue(child);
        queryOneMock.mockReturnValue(createCamera({ id: 44 }));

        await recordingService.startRecording(44);
        const shutdownPromise = recordingService.shutdown();
        child.emit('close', 255, null);
        await shutdownPromise;

        expect(finalizerMock.drain).toHaveBeenCalledWith(30000);
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

    it('delegates short segment validation to the recovery finalizer', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: false, reason: 'invalid_duration' });
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue(null);

        recordingService.onSegmentCreated(3, '20260502_000000.mp4');
        await Promise.resolve();

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 3,
            filename: '20260502_000000.mp4',
            sourceType: 'final_orphan',
        }));
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_000000.mp4'));
    });

    it('keeps recording maintenance facade methods available during refactor', async () => {
        const { recordingService } = await import('../services/recordingService.js');

        expect(typeof recordingService.cleanupOldSegments).toBe('function');
        expect(typeof recordingService.startBackgroundCleanup).toBe('function');
        expect(typeof recordingService.startScheduledCleanup).toBe('function');
        expect(typeof recordingService.emergencyDiskSpaceCheck).toBe('function');
    });

    it('scheduled cleanup still runs per-camera cleanup before emergency disk check', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const scheduledCallbacks = [];
        const scheduleTimeout = vi.fn((callback) => {
            scheduledCallbacks.push(callback);
            return scheduledCallbacks.length;
        });
        const cleanupSpy = vi.spyOn(recordingService.maintenanceCoordinator, 'cleanupOldSegments')
            .mockResolvedValue({ deleted: 0 });
        const emergencySpy = vi.spyOn(recordingService.maintenanceCoordinator, 'runEmergencyDiskCheck')
            .mockResolvedValue(undefined);

        queryMock.mockReturnValue([{ id: 7 }, { id: 8 }]);
        fsPromisesMock.access.mockRejectedValueOnce(new Error('no recordings dir'));

        recordingService.startScheduledCleanup(scheduleTimeout);
        await scheduledCallbacks[0]();

        expect(cleanupSpy).toHaveBeenCalledWith(7);
        expect(cleanupSpy).toHaveBeenCalledWith(8);
        expect(emergencySpy).toHaveBeenCalledTimes(1);
        expect(scheduleTimeout).toHaveBeenCalledTimes(2);
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
        expect(warnSpy).toHaveBeenCalledWith('[DiskCheck] LOW DISK SPACE: 0.00GB free. Starting emergency cleanup...');
    });

    it('emergency disk cleanup does not directly delete filesystem final orphans', async () => {
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '100\n', stderr: '' }));
        const { recordingService } = await import('../services/recordingService.js');
        const onSegmentSpy = vi.spyOn(recordingService, 'onSegmentCreated').mockImplementation(() => {});

        queryMock.mockReturnValue([]);
        queryOneMock.mockReturnValue({ recording_duration_hours: 1 });
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            const text = String(targetPath);
            if (text.endsWith('recordings')) return ['camera7'];
            if (text.endsWith('camera7')) return ['20260502_070000.mp4'];
            return [];
        });
        fsPromisesMock.stat.mockResolvedValue({
            isDirectory: () => true,
            mtimeMs: Date.parse('2026-05-02T07:00:00.000Z'),
            size: 4096,
        });

        await recordingService.emergencyDiskSpaceCheck();

        expect(onSegmentSpy).toHaveBeenCalledWith(7, '20260502_070000.mp4');
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_070000.mp4'));
    });

    it('keeps unstable-connection segment files in finalizer recovery instead of deleting them inline', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: false, reason: 'invalid_duration' });
        const { recordingService } = await import('../services/recordingService.js');
        const recordingsBasePath = join(process.cwd(), '..', 'recordings');

        queryOneMock.mockReturnValue(null);

        recordingService.onSegmentCreated(3, '20260502_095800.mp4');
        await Promise.resolve();

        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(join(recordingsBasePath, 'camera3', '20260502_095800.mp4'));
        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 3,
            filename: '20260502_095800.mp4',
            sourceType: 'final_orphan',
        }));
    });

    it('does not keep local recording delete or quarantine helpers in the facade', async () => {
        const { readFile } = await import('fs/promises');
        const source = await readFile(new URL('../services/recordingService.js', import.meta.url), 'utf8');

        expect(source).not.toContain('async function deleteRecordingFileSafely');
        expect(source).not.toContain('async function quarantineRecordingFile');
        expect(source).toContain('recordingFileOperationService');
    });

    it('registers the same segment idempotently when scanner and ffmpeg close detect it together', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');

        queryOneMock.mockReturnValue(null);
        recordingService.onSegmentCreated(5, '20260503_020000.mp4');
        recordingService.onSegmentCreated(5, '20260503_020000.mp4');
        await Promise.resolve();

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledTimes(1);
    });

    it('scanner recovers pending partial files that are not registered', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['pending'];
            if (targetPath.endsWith('pending')) return ['20260511_211000.mp4.partial'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
            size: 4096,
            mtimeMs: Date.now() - 120000,
        }));
        const segmentSpy = vi.spyOn(recordingService, 'onSegmentCreated');

        const runs = [];
        let scheduled = false;
        recordingService.startSegmentScanner((callback) => {
            if (!scheduled) {
                scheduled = true;
                runs.push(callback());
            }
            return 1;
        });
        await Promise.all(runs);

        expect(segmentSpy).toHaveBeenCalledWith(8, '20260511_211000.mp4.partial');
    });

    it('scanner recovers pending partial files for disabled cameras', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 0 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['pending'];
            if (targetPath.endsWith('pending')) return ['20260511_211000.mp4.partial'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
            size: 4096,
            mtimeMs: Date.now() - 120000,
        }));
        const segmentSpy = vi.spyOn(recordingService, 'onSegmentCreated');

        const runs = [];
        let scheduled = false;
        recordingService.startSegmentScanner((callback) => {
            if (!scheduled) {
                scheduled = true;
                runs.push(callback());
            }
            return 1;
        });
        await Promise.all(runs);

        expect(segmentSpy).toHaveBeenCalledWith(8, '20260511_211000.mp4.partial');
    });

    it('removes stale pending partial when final segment already exists in DB', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
        queryMock.mockReturnValue([{ filename: '20260512_000005.mp4' }]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['pending'];
            if (targetPath.endsWith('pending')) return ['20260512_000005.mp4.partial'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
            size: 4096,
            mtimeMs: Date.now() - 900000,
        }));

        const timers = [];
        recordingService.startSegmentScanner((fn, delay) => {
            timers.push({ fn, delay });
            return 1;
        });
        await timers[0].fn();

        expect(fsPromisesMock.unlink).toHaveBeenCalledWith(expect.stringContaining('20260512_000005.mp4.partial'));
        expect(finalizerMock.finalizeSegment).not.toHaveBeenCalled();
    });

    it('scanner reconciles valid final orphan MP4 files into DB through finalizer', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['20260511_211000.mp4'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8'),
            size: 4096,
            mtimeMs: Date.now() - 120000,
        }));
        const segmentSpy = vi.spyOn(recordingService, 'onSegmentCreated');

        const runs = [];
        let scheduled = false;
        recordingService.startSegmentScanner((callback) => {
            if (!scheduled) {
                scheduled = true;
                runs.push(callback());
            }
            return 1;
        });
        await Promise.all(runs);

        expect(segmentSpy).toHaveBeenCalledWith(8, '20260511_211000.mp4');
    });

    it('background cleanup requeues final orphans for recovery before deletion', async () => {
        vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
        const { recordingService } = await import('../services/recordingService.js');
        const onSegmentSpy = vi.spyOn(recordingService, 'onSegmentCreated').mockImplementation(() => {});

        const scheduled = [];
        const scheduleTimeout = (callback) => {
            scheduled.push(callback);
            return scheduled.length;
        };

        queryOneMock.mockReturnValue({ recording_duration_hours: 1 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            const text = String(targetPath);
            if (text.endsWith('recordings')) return ['camera3'];
            if (text.endsWith('camera3')) return ['20260502_070000.mp4'];
            return [];
        });
        fsPromisesMock.stat.mockResolvedValue({
            isDirectory: () => true,
            size: 4096,
            mtimeMs: Date.parse('2026-05-02T07:00:00.000Z'),
        });

        recordingService.startBackgroundCleanup(scheduleTimeout);
        await scheduled[0]();
        await scheduled[1]();

        expect(onSegmentSpy).toHaveBeenCalledWith(3, '20260502_070000.mp4');
        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_070000.mp4'));
    });

    it('starts and stops the attached recording scheduler explicitly', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const scheduler = {
            register: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
        };

        recordingService.attachScheduler(scheduler);
        recordingService.initializeBackgroundWork();
        await recordingService.shutdown();

        expect(scheduler.register).toHaveBeenCalled();
        expect(scheduler.start).toHaveBeenCalledTimes(1);
        expect(scheduler.stop).toHaveBeenCalledTimes(1);
    });
});
