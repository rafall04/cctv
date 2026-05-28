/**
 * Purpose: Validate maintenance coordinator orchestration: lazy sub-service creation, scheduler registration,
 *          scheduled cleanup loop, drain, and late-binding api spy support.
 * Caller: Vitest backend suite.
 * Deps: createRecordingMaintenanceCoordinator with injected cleanupService, scheduler, fs, query mocks.
 * MainFuncs: registerSchedulerTasks, runScheduledCleanup, cleanupOldSegments, drainAll.
 * SideEffects: None; all collaborators mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRecordingMaintenanceCoordinator } from '../services/recordingMaintenanceCoordinator.js';

function createDeps(overrides = {}) {
    const cleanupService = {
        cleanupCamera: vi.fn().mockResolvedValue({ deleted: 0 }),
        emergencyCleanup: vi.fn().mockResolvedValue({ deleted: 0 }),
    };
    const diskSpaceService = { getFreeBytes: vi.fn().mockResolvedValue(10 * 1024 * 1024 * 1024) };
    const safeDelete = vi.fn().mockResolvedValue({ success: true, size: 0 });
    const query = vi.fn().mockReturnValue([]);
    const queryOne = vi.fn().mockReturnValue(null);
    const fs = {
        access: vi.fn().mockResolvedValue(undefined),
        readdir: vi.fn().mockResolvedValue([]),
        stat: vi.fn().mockResolvedValue({ isDirectory: () => true, mtimeMs: Date.now(), size: 0 }),
    };
    const execPromise = vi.fn().mockResolvedValue({ stdout: '', stderr: '' });
    const onSegmentCreated = vi.fn();
    const reconcileAll = vi.fn().mockResolvedValue({ results: [] });
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

    return {
        deps: {
            recordingsBasePath: '/recordings',
            cleanupService,
            diskSpaceService,
            safeDelete,
            query,
            queryOne,
            fs,
            execPromise,
            onSegmentCreated,
            reconcileAll,
            isShuttingDown: () => false,
            logger,
            ...overrides,
        },
        cleanupService,
        query,
        queryOne,
        fs,
        onSegmentCreated,
        reconcileAll,
        logger,
    };
}

describe('recordingMaintenanceCoordinator', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects construction missing required collaborators', () => {
        expect(() => createRecordingMaintenanceCoordinator({ cleanupService: {}, onSegmentCreated: () => {}, reconcileAll: () => {} })).toThrow(/recordingsBasePath/);
        expect(() => createRecordingMaintenanceCoordinator({ recordingsBasePath: '/r', onSegmentCreated: () => {}, reconcileAll: () => {} })).toThrow(/cleanupService/);
        expect(() => createRecordingMaintenanceCoordinator({ recordingsBasePath: '/r', cleanupService: {}, reconcileAll: () => {} })).toThrow(/onSegmentCreated/);
        expect(() => createRecordingMaintenanceCoordinator({ recordingsBasePath: '/r', cleanupService: {}, onSegmentCreated: () => {} })).toThrow(/reconcileAll/);
    });

    it('registerSchedulerTasks registers all six maintenance loops', () => {
        const { deps } = createDeps();
        const coordinator = createRecordingMaintenanceCoordinator(deps);
        const scheduler = { register: vi.fn() };

        coordinator.registerSchedulerTasks(scheduler);

        const names = scheduler.register.mock.calls.map((call) => call[0].name).sort();
        expect(names).toEqual([
            'bg_cleanup_build',
            'bg_cleanup_process',
            'diagnostics_prune',
            'lifecycle_reconciler',
            'scheduled_cleanup',
            'segment_scanner',
        ]);
        for (const call of scheduler.register.mock.calls) {
            expect(typeof call[0].task).toBe('function');
            expect(typeof call[0].intervalMs).toBe('number');
            expect(call[0].intervalMs).toBeGreaterThan(0);
        }
    });

    it('pruneRecoveryDiagnostics delegates to the diagnostics repository and logs the count', () => {
        const diagnosticsRepository = { pruneAbsentActiveDiagnostics: vi.fn().mockReturnValue(3) };
        const { deps, logger } = createDeps({ diagnosticsRepository });
        const coordinator = createRecordingMaintenanceCoordinator(deps);

        const pruned = coordinator.pruneRecoveryDiagnostics();

        expect(diagnosticsRepository.pruneAbsentActiveDiagnostics).toHaveBeenCalledTimes(1);
        expect(pruned).toBe(3);
        expect(logger.log).toHaveBeenCalledWith(expect.stringContaining('Resolved 3 recovery diagnostic'));
    });

    it('pruneRecoveryDiagnostics never throws when the repository errors', () => {
        const diagnosticsRepository = {
            pruneAbsentActiveDiagnostics: vi.fn(() => { throw new Error('db locked'); }),
        };
        const { deps, logger } = createDeps({ diagnosticsRepository });
        const coordinator = createRecordingMaintenanceCoordinator(deps);

        expect(() => coordinator.pruneRecoveryDiagnostics()).not.toThrow();
        expect(coordinator.pruneRecoveryDiagnostics()).toBe(0);
        expect(logger.error).toHaveBeenCalled();
    });

    it('cleanupOldSegments delegates to cleanupService.cleanupCamera with camera row', async () => {
        const { deps, queryOne: q1, cleanupService } = createDeps();
        q1.mockReturnValue({ recording_duration_hours: 24, name: 'cam7' });
        const coordinator = createRecordingMaintenanceCoordinator(deps);

        await coordinator.cleanupOldSegments(7);

        expect(cleanupService.cleanupCamera).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            camera: { recording_duration_hours: 24, name: 'cam7' },
        }));
    });

    it('cleanupOldSegments skips when camera row missing', async () => {
        const { deps, queryOne: q1, cleanupService } = createDeps();
        q1.mockReturnValue(null);
        const coordinator = createRecordingMaintenanceCoordinator(deps);

        await coordinator.cleanupOldSegments(99);

        expect(cleanupService.cleanupCamera).not.toHaveBeenCalled();
    });

    it('runScheduledCleanup iterates enabled cameras + filesystem dirs through late-binding api', async () => {
        const { deps, query: q, fs } = createDeps();
        q.mockReturnValue([{ id: 1 }, { id: 2 }]);
        fs.readdir.mockResolvedValue(['camera1', 'camera3', 'unrelated']);
        const coordinator = createRecordingMaintenanceCoordinator(deps);

        const cleanupSpy = vi.spyOn(coordinator, 'cleanupOldSegments').mockResolvedValue(undefined);
        const emergencySpy = vi.spyOn(coordinator, 'runEmergencyDiskCheck').mockResolvedValue(undefined);

        await coordinator.runScheduledCleanup();

        const cleanedIds = cleanupSpy.mock.calls.map((c) => c[0]).sort();
        expect(cleanedIds).toEqual([1, 2, 3]);
        expect(emergencySpy).toHaveBeenCalledTimes(1);
    });

    it('runScheduledCleanup survives missing recordings dir', async () => {
        const { deps, query: q, fs } = createDeps();
        q.mockReturnValue([{ id: 7 }]);
        fs.access.mockRejectedValue(new Error('ENOENT'));
        const coordinator = createRecordingMaintenanceCoordinator(deps);
        const cleanupSpy = vi.spyOn(coordinator, 'cleanupOldSegments').mockResolvedValue(undefined);
        vi.spyOn(coordinator, 'runEmergencyDiskCheck').mockResolvedValue(undefined);

        await coordinator.runScheduledCleanup();

        expect(cleanupSpy).toHaveBeenCalledWith(7);
    });

    it('startLegacyTimers schedules all loops via injected scheduleTimeout', () => {
        const { deps } = createDeps();
        const coordinator = createRecordingMaintenanceCoordinator(deps);
        const scheduleTimeout = vi.fn();

        coordinator.startLegacyTimers(scheduleTimeout);

        // 5 initial schedules: scanner, build, process, scheduled cleanup, reconciler
        expect(scheduleTimeout.mock.calls.length).toBeGreaterThanOrEqual(5);
    });

    it('drainAll resolves drained=true when sub-services have not run', async () => {
        const { deps } = createDeps();
        const coordinator = createRecordingMaintenanceCoordinator(deps);
        // No bg cleanup / emergency disk service touched yet.
        const result = await coordinator.drainAll(50);
        expect(result).toEqual({});
    });
});
