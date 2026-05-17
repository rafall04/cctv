/*
Purpose: Validate recording lifecycle reconciler orchestration and safety guards.
Caller: Vitest backend suite.
Deps: recordingLifecycleReconciler with injected DB/process/service dependencies.
MainFuncs: reconcileCamera and reconcileAll behavior tests.
SideEffects: Uses mocks only; no real DB, process, or filesystem work.
*/

import { describe, expect, it, vi } from 'vitest';
import { createRecordingLifecycleReconciler } from '../services/recordingLifecycleReconciler.js';

function camera(overrides = {}) {
    return {
        id: 1,
        enabled: 1,
        enable_recording: 1,
        is_online: 1,
        delivery_type: 'internal_hls',
        ...overrides,
    };
}

function createDeps({ cameras = [camera()], processStatus = { status: 'stopped', isRecording: false } } = {}) {
    const byId = new Map(cameras.map((item) => [item.id, item]));
    return {
        query: vi.fn(() => cameras),
        queryOne: vi.fn((sql, params) => byId.get(params[0]) || null),
        recordingProcessManager: {
            getStatus: vi.fn(() => processStatus),
        },
        recordingService: {
            getRecordingStatus: vi.fn(() => ({ status: 'stopped', cooldownUntil: 0, suspendedReason: null })),
            handleCameraBecameOnline: vi.fn(() => Promise.resolve({ success: true })),
            handleCameraBecameOffline: vi.fn(() => Promise.resolve({ success: true })),
        },
        logger: {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    };
}

describe('recordingLifecycleReconciler', () => {
    it('starts a stopped eligible online camera through the recording facade', async () => {
        const deps = createDeps();
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(1, 'periodic_safety_net', 1000);

        expect(result).toMatchObject({ cameraId: 1, action: 'start', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).toHaveBeenCalledWith(1, 1000, { clearCooldown: true });
        expect(deps.recordingService.handleCameraBecameOffline).not.toHaveBeenCalled();
    });

    it('suspends an active recording when the camera is offline', async () => {
        const deps = createDeps({
            cameras: [camera({ id: 2, is_online: 0 })],
            processStatus: { status: 'recording', isRecording: true },
        });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(2, 'health_offline', 1000);

        expect(result).toMatchObject({ cameraId: 2, action: 'stop_offline', success: true });
        expect(deps.recordingService.handleCameraBecameOffline).toHaveBeenCalledWith(2, 1000);
        expect(deps.recordingService.handleCameraBecameOnline).not.toHaveBeenCalled();
    });

    it('does nothing for unrecordable cameras', async () => {
        const deps = createDeps({ cameras: [camera({ id: 3, delivery_type: 'external_mjpeg' })] });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(3, 'periodic_safety_net', 1000);

        expect(result).toMatchObject({ cameraId: 3, action: 'noop_unrecordable', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).not.toHaveBeenCalled();
    });

    it('single-flights duplicate reconcile calls for the same camera', async () => {
        let resolveStart;
        const deps = createDeps();
        deps.recordingService.handleCameraBecameOnline.mockReturnValue(new Promise((resolve) => {
            resolveStart = resolve;
        }));
        const reconciler = createRecordingLifecycleReconciler(deps);

        const first = reconciler.reconcileCamera(1, 'runtime_online_signal', 1000);
        const second = await reconciler.reconcileCamera(1, 'runtime_online_signal', 1000);

        expect(second).toMatchObject({ cameraId: 1, action: 'skipped_in_flight', success: true });
        resolveStart({ success: true });
        expect(await first).toMatchObject({ cameraId: 1, action: 'start', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).toHaveBeenCalledTimes(1);
    });

    it('continues reconcileAll after one camera fails', async () => {
        const deps = createDeps({ cameras: [camera({ id: 1 }), camera({ id: 2 })] });
        deps.recordingService.handleCameraBecameOnline
            .mockRejectedValueOnce(new Error('start failed'))
            .mockResolvedValueOnce({ success: true });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileAll('periodic_safety_net', 1000);

        expect(result.checked).toBe(2);
        expect(result.results).toHaveLength(2);
        expect(result.results[0]).toMatchObject({ cameraId: 1, action: 'error', success: false });
        expect(result.results[1]).toMatchObject({ cameraId: 2, action: 'start', success: true });
    });
});
