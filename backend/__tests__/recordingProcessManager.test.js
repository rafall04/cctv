/**
 * Purpose: Verify FFmpeg recording process lifecycle and spawn configuration.
 * Caller: Vitest backend test suite.
 * Deps: mocked child_process spawn and recordingProcessManager.
 * MainFuncs: RecordingProcessManager.start, stop, restart, shutdownAll.
 * SideEffects: Child process spawning is mocked.
 */
import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
    spawn: spawnMock,
}));

function createProcess(pid = 1000) {
    const process = new EventEmitter();
    process.pid = pid;
    process.stdout = new EventEmitter();
    process.stderr = new EventEmitter();
    process.kill = vi.fn();
    return process;
}

describe('RecordingProcessManager', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();
    });

    it('awaits close when stopping an active recording', async () => {
        const child = createProcess(111);
        spawnMock.mockReturnValue(child);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });

        await manager.start(1, {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 1 },
            streamSource: 'internal',
        });

        const stopPromise = manager.stop(1, 'manual_stop');
        expect(child.kill).toHaveBeenCalledWith('SIGINT');

        child.emit('close', 255, null);
        await expect(stopPromise).resolves.toMatchObject({
            cameraId: 1,
            reason: 'intentional_stop',
            forcedKill: false,
        });
        expect(manager.getStatus(1)).toEqual({ isRecording: false, status: 'stopped' });
    });

    it('sends SIGKILL after graceful timeout', async () => {
        const child = createProcess(222);
        spawnMock.mockReturnValue(child);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 1000 });

        await manager.start(2, {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 2 },
            streamSource: 'internal',
        });

        const stopPromise = manager.stop(2, 'server_shutdown');
        await vi.advanceTimersByTimeAsync(1000);
        expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGKILL');

        child.emit('close', null, 'SIGKILL');
        await expect(stopPromise).resolves.toMatchObject({
            cameraId: 2,
            reason: 'intentional_shutdown',
            forcedKill: true,
        });
    });

    it('serializes restart until the old process closes', async () => {
        const first = createProcess(333);
        const second = createProcess(444);
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });
        const config = {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 3 },
            streamSource: 'internal',
        };

        await manager.start(3, config);
        const restartPromise = manager.restart(3, 'stream_frozen', config);

        expect(first.kill).toHaveBeenCalledWith('SIGINT');
        expect(spawnMock).toHaveBeenCalledTimes(1);

        first.emit('close', 255, null);
        await restartPromise;

        expect(spawnMock).toHaveBeenCalledTimes(2);
        expect(manager.getStatus(3)).toMatchObject({ isRecording: true, pid: 444 });
    });

    it('shuts down all active recordings and waits for close events', async () => {
        const first = createProcess(555);
        const second = createProcess(666);
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });

        await manager.start(5, { ffmpegArgs: ['a'], camera: { id: 5 }, streamSource: 'internal' });
        await manager.start(6, { ffmpegArgs: ['b'], camera: { id: 6 }, streamSource: 'internal' });

        const shutdownPromise = manager.shutdownAll('server_shutdown');
        first.emit('close', 255, null);
        second.emit('close', 255, null);

        await expect(shutdownPromise).resolves.toHaveLength(2);
        expect(manager.getActiveCameraIds()).toEqual([]);
    });

    it('detachAll leaves recorders RUNNING and only releases our side', async () => {
        // The point of the whole detached-recorder design: a backend restart must
        // not signal ffmpeg. Killing here is what used to truncate a segment per
        // camera on every deploy.
        const first = createProcess(901);
        const second = createProcess(902);
        spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager();

        await manager.start(91, { ffmpegArgs: ['a'], camera: { id: 91 }, streamSource: 'internal' });
        await manager.start(92, { ffmpegArgs: ['b'], camera: { id: 92 }, streamSource: 'internal' });

        const detached = manager.detachAll();

        expect(first.kill).not.toHaveBeenCalled();
        expect(second.kill).not.toHaveBeenCalled();
        expect(detached).toEqual([{ cameraId: 91, pid: 901 }, { cameraId: 92, pid: 902 }]);
        expect(manager.getActiveCameraIds()).toEqual([]);
    });

    it('adopts a recorder it did not spawn, tracked by pid alone', async () => {
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager();

        const result = manager.adopt(10, { pid: 4242, camera: { id: 10 }, streamSource: 'internal' });

        expect(result).toMatchObject({ success: true, pid: 4242 });
        expect(manager.getStatus(10)).toMatchObject({ isRecording: true, pid: 4242, adopted: true });
        expect(spawnMock).not.toHaveBeenCalled();
        manager.detachAll();
    });

    it('rejects adoption of an invalid pid', async () => {
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager();

        expect(manager.adopt(11, { pid: 0 })).toMatchObject({ success: false });
        expect(manager.adopt(11, { pid: undefined })).toMatchObject({ success: false });
        expect(manager.getStatus(11)).toEqual({ isRecording: false, status: 'stopped' });
    });

    it('signals an adopted recorder by pid, since there is no child handle', async () => {
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager({ gracefulStopTimeoutMs: 5000 });
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

        manager.adopt(12, { pid: 5150, camera: { id: 12 }, streamSource: 'internal' });
        manager.stop(12, 'stop_disabled');

        expect(killSpy).toHaveBeenCalledWith(5150, 'SIGINT');
        killSpy.mockRestore();
        manager.detachAll();
    });

    it('passes explicit spawn options to FFmpeg', async () => {
        const child = createProcess(777);
        spawnMock.mockReturnValue(child);
        const { RecordingProcessManager } = await import('../services/recordingProcessManager.js');
        const manager = new RecordingProcessManager();

        await manager.start(7, {
            ffmpegArgs: ['-i', 'rtsp://camera'],
            camera: { id: 7 },
            streamSource: 'internal',
            spawnOptions: { env: { TZ: 'Asia/Jakarta' } },
        });

        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', ['-i', 'rtsp://camera'], {
            env: { TZ: 'Asia/Jakarta' },
        });
    });
});
