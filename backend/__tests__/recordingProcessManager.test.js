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
});
