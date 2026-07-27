/**
 * Purpose: Verify boot-time adoption of recorders left running by the previous
 *          backend instance — the hand-off that makes a deploy invisible to recording.
 * Caller: Vitest backend suite.
 * Deps: createRecordingAdopter with injected scan/reap/query/processManager.
 * SideEffects: None; every boundary is injected.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingAdopter } from '../services/recordingAdopter.js';

const BASE = '/srv/rec';

function makeProcessManager() {
    return {
        adopt: vi.fn(() => ({ success: true })),
    };
}

function makeAdopter(overrides = {}) {
    const processManager = overrides.processManager || makeProcessManager();
    const reap = overrides.reap || vi.fn(async () => ({ killed: [] }));
    const scan = overrides.scan || vi.fn(async () => ({ processes: [] }));
    const query = overrides.query || vi.fn(() => []);
    const adopter = createRecordingAdopter({
        query,
        scan,
        reap,
        processManager,
        recordingsBasePath: BASE,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
        ...overrides.extra,
    });
    return { adopter, processManager, reap, scan, query };
}

describe('recordingAdopter', () => {
    it('adopts running recorders whose camera still exists', async () => {
        const scan = vi.fn(async () => ({ processes: [{ pid: 101, cameraId: 1 }, { pid: 102, cameraId: 5 }] }));
        const query = vi.fn(() => [{ id: 1, stream_source: 'internal' }, { id: 5, stream_source: 'external' }]);
        const { adopter, processManager, reap } = makeAdopter({ scan, query });

        const result = await adopter.adoptExisting();

        expect(result.adopted).toEqual([{ cameraId: 1, pid: 101 }, { cameraId: 5, pid: 102 }]);
        expect(processManager.adopt).toHaveBeenCalledTimes(2);
        expect(processManager.adopt).toHaveBeenCalledWith(1, expect.objectContaining({
            pid: 101,
            streamSource: 'internal',
            stderrLogPath: expect.stringContaining('camera1'),
        }));
        // Adopted pids must be protected from the reap pass, or we'd kill exactly
        // the processes we just decided to keep.
        expect(reap).toHaveBeenCalledWith(expect.objectContaining({ keepPids: [101, 102] }));
    });

    it('leaves recorders for deleted cameras to be retired', async () => {
        const scan = vi.fn(async () => ({ processes: [{ pid: 101, cameraId: 1 }, { pid: 999, cameraId: 777 }] }));
        const query = vi.fn(() => [{ id: 1, stream_source: 'internal' }]); // 777 no longer exists
        const reap = vi.fn(async () => ({ killed: [999] }));
        const { adopter, processManager } = makeAdopter({ scan, query, reap });

        const result = await adopter.adoptExisting();

        expect(result.adopted).toEqual([{ cameraId: 1, pid: 101 }]);
        expect(result.retired).toEqual([999]);
        expect(processManager.adopt).toHaveBeenCalledTimes(1);
        expect(reap).toHaveBeenCalledWith(expect.objectContaining({ keepPids: [101] }));
    });

    it('adopts only one recorder per camera and lets the reap pass retire duplicates', async () => {
        const scan = vi.fn(async () => ({ processes: [{ pid: 101, cameraId: 1 }, { pid: 202, cameraId: 1 }] }));
        const query = vi.fn(() => [{ id: 1, stream_source: 'internal' }]);
        const { adopter, processManager, reap } = makeAdopter({ scan, query });

        const result = await adopter.adoptExisting();

        expect(result.adopted).toEqual([{ cameraId: 1, pid: 101 }]);
        expect(processManager.adopt).toHaveBeenCalledTimes(1);
        expect(reap).toHaveBeenCalledWith(expect.objectContaining({ keepPids: [101] }));
    });

    it('wires adopted recorders through the same callbacks as spawned ones', async () => {
        // Without this, freshness and segment-completion events would silently stop
        // flowing for any camera that survived the restart.
        const scan = vi.fn(async () => ({ processes: [{ pid: 101, cameraId: 1 }] }));
        const query = vi.fn(() => [{ id: 1, stream_source: 'internal' }]);
        const onStderr = vi.fn();
        const { adopter, processManager } = makeAdopter({
            scan,
            query,
            extra: { buildCallbacks: () => ({ onStderr }) },
        });

        await adopter.adoptExisting();

        expect(processManager.adopt).toHaveBeenCalledWith(1, expect.objectContaining({ onStderr }));
    });

    it('no-ops cleanly when nothing is running', async () => {
        const { adopter, processManager, reap } = makeAdopter();

        const result = await adopter.adoptExisting();

        expect(result).toEqual({ success: true, adopted: [], retired: [] });
        expect(processManager.adopt).not.toHaveBeenCalled();
        expect(reap).not.toHaveBeenCalled();
    });

    it('skips on unsupported platforms without touching anything', async () => {
        const scan = vi.fn(async () => ({ skipped: 'unsupported_platform', processes: [] }));
        const { adopter, processManager, reap } = makeAdopter({ scan });

        const result = await adopter.adoptExisting();

        expect(result.skipped).toBe('unsupported_platform');
        expect(processManager.adopt).not.toHaveBeenCalled();
        expect(reap).not.toHaveBeenCalled();
    });

    it('never throws — a broken adoption must not block boot', async () => {
        const scan = vi.fn(async () => { throw new Error('ps exploded'); });
        const { adopter } = makeAdopter({ scan });

        const result = await adopter.adoptExisting();

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/ps exploded/);
    });
});
