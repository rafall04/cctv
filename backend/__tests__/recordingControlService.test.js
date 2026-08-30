/**
 * Purpose: Verify the API-side routing of recording work — direct calls when recording
 *          runs in this process, queued DB requests when the recorder worker owns it.
 * Caller: Vitest backend suite.
 * Deps: mocked config + recordingWorkerStateRepository + recordingService.
 * SideEffects: None.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestReconcileMock = vi.fn(() => true);
const readProcessStateMock = vi.fn();
const readAllProcessStateMock = vi.fn(() => []);
const readHealthSnapshotMock = vi.fn();

const startRecordingMock = vi.fn(async () => ({ success: true }));
const stopRecordingMock = vi.fn(async () => ({ success: true }));
const restartRecordingMock = vi.fn(async () => ({ success: true }));
const reconcileLifecycleMock = vi.fn(async () => ({ success: true }));
const getRecordingStatusMock = vi.fn(() => ({ isRecording: true, status: 'recording' }));
const getActiveRecordingCameraIdsMock = vi.fn(() => []);

let workerEnabled = false;

vi.mock('../config/config.js', () => ({
    config: {
        get recording() {
            return { workerEnabled };
        },
    },
}));

vi.mock('../services/recordingWorkerStateRepository.js', () => ({
    default: {
        requestReconcile: requestReconcileMock,
        readProcessState: readProcessStateMock,
        readAllProcessState: readAllProcessStateMock,
        readHealthSnapshot: readHealthSnapshotMock,
    },
}));

vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        startRecording: startRecordingMock,
        stopRecording: stopRecordingMock,
        restartRecording: restartRecordingMock,
        reconcileRecordingLifecycle: reconcileLifecycleMock,
        getRecordingStatus: getRecordingStatusMock,
        getActiveRecordingCameraIds: getActiveRecordingCameraIdsMock,
    },
}));

async function loadControl() {
    vi.resetModules();
    const mod = await import('../services/recordingControlService.js');
    return mod.default;
}

beforeEach(() => {
    vi.clearAllMocks();
    workerEnabled = false;
    readHealthSnapshotMock.mockReturnValue({ available: true, stale: false });
});

describe('recordingControlService — single-process mode', () => {
    it('calls recordingService directly', async () => {
        const control = await loadControl();

        await control.start(7);
        await control.stop(7, { reason: 'admin_stop' });
        await control.restart(7, 'src_changed');
        await control.reconcile(7, 'settings_changed');

        expect(startRecordingMock).toHaveBeenCalledWith(7);
        expect(stopRecordingMock).toHaveBeenCalledWith(7, { reason: 'admin_stop' });
        expect(restartRecordingMock).toHaveBeenCalledWith(7, 'src_changed');
        expect(reconcileLifecycleMock).toHaveBeenCalledWith(7, 'settings_changed');
        expect(requestReconcileMock).not.toHaveBeenCalled();
    });

    it('reads runtime status straight from the in-process service', async () => {
        const control = await loadControl();

        await expect(control.getRuntimeStatus(7)).resolves.toEqual({ isRecording: true, status: 'recording' });
        expect(getRecordingStatusMock).toHaveBeenCalledWith(7);
    });

    it('restartAllActive restarts every actively-recording camera (in-process, fix #7)', async () => {
        getActiveRecordingCameraIdsMock.mockReturnValue([1, 2, 3]);
        const control = await loadControl();

        const result = await control.restartAllActive('timezone_changed');

        expect(restartRecordingMock).toHaveBeenCalledWith(1, 'timezone_changed');
        expect(restartRecordingMock).toHaveBeenCalledWith(2, 'timezone_changed');
        expect(restartRecordingMock).toHaveBeenCalledWith(3, 'timezone_changed');
        expect(result.restarted).toEqual([1, 2, 3]);
    });

    it('restartAllActive is best-effort: one camera failing does not abort the rest', async () => {
        getActiveRecordingCameraIdsMock.mockReturnValue([1, 2, 3]);
        restartRecordingMock.mockRejectedValueOnce(new Error('boom on camera 1'));
        const control = await loadControl();

        const result = await control.restartAllActive('timezone_changed');

        expect(result.restarted).toEqual([2, 3]); // 1 failed, 2 & 3 still restarted
        expect(restartRecordingMock).toHaveBeenCalledTimes(3);
    });
});

describe('recordingControlService — worker mode', () => {
    beforeEach(() => { workerEnabled = true; });

    it('queues requests instead of spawning a SECOND ffmpeg for the same camera', async () => {
        // The worker already owns a recorder for this camera. Calling into
        // recordingService here would start a competing ffmpeg on the same output dir.
        const control = await loadControl();

        await control.start(7, 'camera_created');
        await control.stop(7, { reason: 'camera_source_updated' });
        await control.restart(7, 'src_changed');
        await control.reconcile(7, 'settings_changed');

        expect(startRecordingMock).not.toHaveBeenCalled();
        expect(stopRecordingMock).not.toHaveBeenCalled();
        expect(restartRecordingMock).not.toHaveBeenCalled();
        expect(reconcileLifecycleMock).not.toHaveBeenCalled();

        expect(requestReconcileMock).toHaveBeenCalledTimes(4);
        // Each imperative carries its own action: routing them all as 'reconcile' is what let the
        // worker answer noop_recording and silently drop an admin stop or a source-change restart.
        expect(requestReconcileMock).toHaveBeenCalledWith(7, 'camera_created', 'start');
        expect(requestReconcileMock).toHaveBeenCalledWith(7, 'camera_source_updated', 'stop');
        expect(requestReconcileMock).toHaveBeenCalledWith(7, 'src_changed', 'restart');
        expect(requestReconcileMock).toHaveBeenCalledWith(7, 'settings_changed');
    });

    it('reads runtime status from what the worker published', async () => {
        readProcessStateMock.mockReturnValue({
            camera_id: 7, pid: 4242, status: 'recording',
            stream_source: 'internal', adopted: 1, started_at: '2026-07-28T05:00:00.000Z',
        });
        const control = await loadControl();

        await expect(control.getRuntimeStatus(7)).resolves.toEqual({
            isRecording: true,
            status: 'recording',
            pid: 4242,
            startTime: '2026-07-28T05:00:00.000Z',
            streamSource: 'internal',
            adopted: true,
        });
        expect(getRecordingStatusMock).not.toHaveBeenCalled();
    });

    it('reports UNKNOWN — not "stopped" — when the worker heartbeat is stale', async () => {
        // Saying "not recording" when we simply cannot see the worker would invite an
        // operator to start a second recorder for a camera that is already recording.
        readHealthSnapshotMock.mockReturnValue({ available: true, stale: true, ageMs: 500000 });
        const control = await loadControl();

        await expect(control.getRuntimeStatus(7)).resolves.toEqual({
            isRecording: false,
            status: 'unknown',
            workerStale: true,
        });
        expect(readProcessStateMock).not.toHaveBeenCalled();
    });

    it('reports stopped when the worker is alive and has no row for the camera', async () => {
        readProcessStateMock.mockReturnValue(null);
        const control = await loadControl();

        await expect(control.getRuntimeStatus(9)).resolves.toEqual({ isRecording: false, status: 'stopped' });
    });

    it('restartAllActive queues a restart ONLY for cameras the worker is recording (fix #7)', async () => {
        readAllProcessStateMock.mockReturnValue([
            { camera_id: 1, status: 'recording' },
            { camera_id: 2, status: 'stopped' },   // not recording → skip
            { camera_id: 3, status: 'recording' },
        ]);
        const control = await loadControl();

        const result = await control.restartAllActive('timezone_changed');

        expect(requestReconcileMock).toHaveBeenCalledWith(1, 'timezone_changed', 'restart');
        expect(requestReconcileMock).toHaveBeenCalledWith(3, 'timezone_changed', 'restart');
        expect(requestReconcileMock).not.toHaveBeenCalledWith(2, 'timezone_changed', 'restart');
        expect(result.restarted).toEqual([1, 3]);
        expect(restartRecordingMock).not.toHaveBeenCalled(); // worker mode → queued, not direct
    });
});
