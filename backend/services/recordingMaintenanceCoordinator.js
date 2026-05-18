// Purpose: Own scheduling and orchestration of recording maintenance loops (scanner, background cleanup,
//          scheduled cleanup, emergency disk check) so the recording facade only owns lifecycle control.
// Caller: recordingService facade (constructor wires + initializeBackgroundWork delegates).
// Deps: recordingRecoveryScanner, recordingBackgroundCleanupService, recordingCleanupService,
//        recordingEmergencyDiskService, recordingDiskSpaceService, recordingFileOperationService,
//        injected query/queryOne/fs/execPromise, scheduler with register({name,task,intervalMs}) API.
// MainFuncs: createRecordingMaintenanceCoordinator → { cleanupOldSegments, runEmergencyDiskCheck, registerSchedulerTasks,
//             startLegacyTimers, ensureRecoveryScanner, ensureBackgroundCleanupService, getEmergencyDiskService,
//             drainAll }.
// SideEffects: Owns lazy sub-service singletons; never spawns processes directly.

import { createRecordingRecoveryScanner } from './recordingRecoveryScanner.js';
import { createRecordingBackgroundCleanupService } from './recordingBackgroundCleanupService.js';
import { createRecordingEmergencyDiskService } from './recordingEmergencyDiskService.js';
import {
    RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
    RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS,
    RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS,
} from './recordingIntervalsPolicy.js';

export function createRecordingMaintenanceCoordinator({
    recordingsBasePath,
    cleanupService,
    diskSpaceService,
    safeDelete,
    query,
    queryOne,
    fs,
    execPromise,
    onSegmentCreated,
    reconcileAll,
    isShuttingDown = () => false,
    logger = console,
} = {}) {
    if (!recordingsBasePath) throw new Error('recordingMaintenanceCoordinator requires recordingsBasePath');
    if (!cleanupService) throw new Error('recordingMaintenanceCoordinator requires cleanupService');
    if (typeof onSegmentCreated !== 'function') {
        throw new Error('recordingMaintenanceCoordinator requires onSegmentCreated callback');
    }
    if (typeof reconcileAll !== 'function') {
        throw new Error('recordingMaintenanceCoordinator requires reconcileAll callback');
    }

    let recoveryScanner = null;
    let backgroundCleanupService = null;
    let emergencyDiskService = null;
    // Late-binding api so tests can vi.spyOn(api.method) and have cross-method
    // calls (e.g. runScheduledCleanup → cleanupOldSegments) hit the spy.
    const api = {};

    function ensureRecoveryScanner() {
        if (!recoveryScanner) {
            recoveryScanner = createRecordingRecoveryScanner({
                recordingsBasePath,
                onSegmentCreated,
                logger,
            });
        }
        return recoveryScanner;
    }

    function ensureBackgroundCleanupService() {
        if (!backgroundCleanupService) {
            backgroundCleanupService = createRecordingBackgroundCleanupService({
                recordingsBasePath,
                fs,
                query,
                queryOne,
                ffprobe: (filePath) => execPromise(`ffprobe -v error "${filePath}"`, { timeout: 3000 }),
                onSegmentCreated,
                logger,
            });
        }
        return backgroundCleanupService;
    }

    function getEmergencyDiskService() {
        if (!emergencyDiskService) {
            emergencyDiskService = createRecordingEmergencyDiskService({
                recordingsBasePath,
                cleanupService,
                diskSpaceService,
                fs,
                safeDelete,
                getCameraRetentionHours: (cameraId) => {
                    const camera = queryOne(
                        'SELECT recording_duration_hours FROM cameras WHERE id = ?',
                        [cameraId]
                    );
                    return camera?.recording_duration_hours;
                },
                onRecoverOrphan: ({ cameraId, filename }) => onSegmentCreated(cameraId, filename),
                logger,
            });
        }
        return emergencyDiskService;
    }

    async function cleanupOldSegments(cameraId) {
        try {
            const camera = queryOne(
                'SELECT recording_duration_hours, name FROM cameras WHERE id = ?',
                [cameraId]
            );
            if (!camera) {
                logger.log?.(`[Cleanup] Camera ${cameraId} not found, skipping cleanup`);
                return;
            }
            return await cleanupService.cleanupCamera({
                cameraId,
                camera,
                nowMs: Date.now(),
            });
        } catch (error) {
            logger.error?.(`[Cleanup] Error cleaning up camera ${cameraId}:`, error);
        }
    }

    async function runEmergencyDiskCheck() {
        return getEmergencyDiskService().runEmergencyCheck();
    }

    async function runScheduledCleanup() {
        try {
            const enabledCameras = query(
                'SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1'
            );
            const allCameraIds = new Set(enabledCameras.map((c) => c.id));

            try {
                await fs.access(recordingsBasePath);
                const dirs = await fs.readdir(recordingsBasePath);
                for (const d of dirs) {
                    const match = d.match(/camera(\d+)/);
                    if (match) allCameraIds.add(parseInt(match[1], 10));
                }
            } catch { /* recordings dir missing — OK */ }

            logger.log?.(`[Cleanup] Running scheduled cleanup for ${allCameraIds.size} cameras...`);
            for (const cameraId of allCameraIds) {
                await api.cleanupOldSegments(cameraId);
            }

            await api.runEmergencyDiskCheck();
            logger.log?.('[Cleanup] Scheduled cleanup complete');
        } catch (error) {
            logger.error?.('[Cleanup] Scheduled cleanup error:', error);
        }
    }

    function registerSchedulerTasks(scheduler) {
        const scanner = ensureRecoveryScanner();
        const bg = ensureBackgroundCleanupService();

        scheduler.register({
            name: 'segment_scanner',
            task: () => scanner.scanOnce(),
            intervalMs: scanner.intervalMs,
            initialDelayMs: scanner.intervalMs,
        });
        scheduler.register({
            name: 'bg_cleanup_build',
            task: () => bg.buildQueue(),
            intervalMs: bg.buildIntervalMs,
            initialDelayMs: bg.buildInitialDelayMs,
        });
        scheduler.register({
            name: 'bg_cleanup_process',
            task: () => bg.processOneQueueItem(),
            intervalMs: bg.processIntervalMs,
            initialDelayMs: bg.processIntervalMs,
        });
        scheduler.register({
            name: 'scheduled_cleanup',
            task: () => runScheduledCleanup(),
            intervalMs: RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS,
            initialDelayMs: RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS,
        });
        scheduler.register({
            name: 'lifecycle_reconciler',
            task: async () => {
                if (isShuttingDown()) return;
                await reconcileAll('periodic_safety_net');
            },
            intervalMs: RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
            initialDelayMs: RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
        });
    }

    function startLegacyTimers(scheduleTimeout = setTimeout) {
        const scanner = ensureRecoveryScanner();
        const bg = ensureBackgroundCleanupService();

        const scanCycle = async () => {
            await scanner.scanOnce();
            scheduleTimeout(scanCycle, scanner.intervalMs);
        };
        const buildCycle = async () => {
            await bg.buildQueue();
            scheduleTimeout(buildCycle, bg.buildIntervalMs);
        };
        const processCycle = async () => {
            await bg.processOneQueueItem();
            scheduleTimeout(processCycle, bg.processIntervalMs);
        };
        const scheduledCleanupCycle = async () => {
            await runScheduledCleanup();
            scheduleTimeout(scheduledCleanupCycle, RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS);
        };
        const reconcileCycle = async () => {
            try {
                if (!isShuttingDown()) {
                    await reconcileAll('periodic_safety_net');
                }
            } catch (error) {
                logger.error?.('[RecordingReconciler] Error during lifecycle reconciliation:', error.message);
            } finally {
                scheduleTimeout(reconcileCycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
            }
        };

        scheduleTimeout(scanCycle, scanner.intervalMs);
        scheduleTimeout(buildCycle, bg.buildInitialDelayMs);
        scheduleTimeout(processCycle, bg.processIntervalMs);
        scheduleTimeout(scheduledCleanupCycle, RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS);
        scheduleTimeout(reconcileCycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
    }

    async function drainAll(timeoutMs = 10000) {
        const results = {};
        if (backgroundCleanupService?.drain) {
            results.bgCleanup = await backgroundCleanupService.drain(timeoutMs);
        }
        if (emergencyDiskService?.drain) {
            results.emergencyDisk = await emergencyDiskService.drain(timeoutMs);
        }
        return results;
    }

    Object.assign(api, {
        cleanupOldSegments,
        runScheduledCleanup,
        runEmergencyDiskCheck,
        registerSchedulerTasks,
        startLegacyTimers,
        ensureRecoveryScanner,
        ensureBackgroundCleanupService,
        getEmergencyDiskService,
        drainAll,
    });
    return api;
}
