// Purpose: Coordinate recording facade behavior, DB state, health recovery, and segment processing.
// Caller: recording routes, camera health service, server shutdown lifecycle.
// Deps: FFmpeg process manager, SQLite connection pool, filesystem, camera delivery utilities, lifecycle reconciler.
// MainFuncs: startRecording, stopRecording, restartRecording, shutdown, getRecordingStatus, reconcileRecordingLifecycleAll.
// SideEffects: Starts/stops FFmpeg via process manager, updates DB state, remuxes segment files, quarantines expired invalid files.

import { existsSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import recordingProcessManager from './recordingProcessManager.js';
import { createRecordingCleanupService } from './recordingCleanupService.js';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import recordingRecoveryService from './recordingRecoveryService.js';
import recordingFileOperationService from './recordingFileOperationService.js';
import { createRecordingLifecycleReconciler } from './recordingLifecycleReconciler.js';
import recordingDiskSpaceService from './recordingDiskSpaceService.js';
import { createRecordingMaintenanceCoordinator } from './recordingMaintenanceCoordinator.js';
import { createRecordingAutoStarter } from './recordingAutoStarter.js';
import { resolveSegmentSource } from './recordingSegmentFilePolicy.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import { createRecordingHealthMonitor, computeCooldownMs } from './recordingHealthMonitor.js';
import {
    buildRecordingFfmpegArgs,
    getRecordingSourceConfig,
    maskRecordingSourceForLog,
    prepareRecordingStart,
} from './recordingStarter.js';
import { parseRecordingStderrLine } from './recordingStderrParser.js';
import {
    RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
    RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS as SCHEDULED_CLEANUP_INITIAL_DELAY_MS,
    RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS as SCHEDULED_CLEANUP_INTERVAL_MS,
} from './recordingIntervalsPolicy.js';
const execPromise = promisify(exec);

const cleanupService = createRecordingCleanupService({
    repository: recordingSegmentRepository,
    recordingsBasePath: RECORDINGS_BASE_PATH,
    safeDelete: recordingFileOperationService.deleteFileSafely,
    recoveryService: recordingRecoveryService,
    onRecoverOrphan: ({ cameraId, filename, filePath, sourceType }) => recordingRecoveryService.enqueueRecovery({
        cameraId,
        filename,
        sourcePath: filePath,
        sourceType,
    }),
    logger: console,
});

// Re-exports preserve historical facade imports used by tests and external callers.
export const computeRecordingCooldownMs = computeCooldownMs;
export { buildRecordingFfmpegArgs, getRecordingSourceConfig, maskRecordingSourceForLog };

/**
 * Recording Service
 * Handles CCTV recording dengan stream copy (no re-encoding)
 */
class RecordingService {
    constructor() {
        this.isShuttingDown = false;
        this.scheduler = null;

        // Ensure recordings directory exists
        if (!existsSync(RECORDINGS_BASE_PATH)) {
            mkdirSync(RECORDINGS_BASE_PATH, { recursive: true });
        }

        this.lifecycleReconciler = createRecordingLifecycleReconciler({
            query,
            queryOne,
            recordingService: this,
            recordingProcessManager,
            logger: console,
        });

        this.healthMonitor = createRecordingHealthMonitor({
            processManager: recordingProcessManager,
            queryOne,
            startRecording: (cameraId) => this.startRecording(cameraId),
            stopRecording: (cameraId, opts) => this.stopRecording(cameraId, opts),
            restartRecording: (cameraId, reason) => this.restartRecording(cameraId, reason),
            isShuttingDown: () => this.isShuttingDown,
            logger: console,
        });
        this.healthMonitor.start();

        this.autoStarter = createRecordingAutoStarter({
            query,
            suspendOffline: (cameraId) => this.suspendRecordingForOffline(cameraId),
            reconcileAll: (reason) => this.reconcileRecordingLifecycleAll(reason),
            logger: console,
        });

        this.maintenanceCoordinator = createRecordingMaintenanceCoordinator({
            recordingsBasePath: RECORDINGS_BASE_PATH,
            cleanupService,
            diskSpaceService: recordingDiskSpaceService,
            safeDelete: recordingFileOperationService.deleteFileSafely,
            query,
            queryOne,
            fs: fsPromises,
            execPromise,
            onSegmentCreated: (cameraId, filename) => this.onSegmentCreated(cameraId, filename),
            reconcileAll: (reason) => this.reconcileRecordingLifecycleAll(reason),
            isShuttingDown: () => this.isShuttingDown,
            logger: console,
        });
    }

    // Thin wrappers preserve the historical facade API used by tests and by
    // the lifecycle reconciler. All state lives in this.healthMonitor.
    // Health state pass-through. External callers should prefer
    // reconcileRecordingLifecycle(); these wrappers exist for the lifecycle
    // reconciler (which deliberately decides start/stop transitions) and for
    // existing unit tests.
    ensureRuntimeHealthState(cameraId) { return this.healthMonitor.ensureState(cameraId); }
    clearRuntimeHealthState(cameraId) { this.healthMonitor.clearState(cameraId); }
    markRecordingRecovered(cameraId, now = Date.now()) { return this.healthMonitor.markRecovered(cameraId, now); }
    markRecordingStarted(cameraId, now = Date.now()) { return this.healthMonitor.markStarted(cameraId, now); }
    markRecordingFailure(cameraId, reason, now = Date.now()) { return this.healthMonitor.markFailure(cameraId, reason, now); }
    suspendRecordingForOffline(cameraId, now = Date.now()) { return this.healthMonitor.suspendOffline(cameraId, now); }
    async attemptRecordingRecovery(cameraId, reason, now = Date.now()) {
        return this.healthMonitor.attemptRecovery(cameraId, reason, now);
    }
    /** @internal — call reconcileRecordingLifecycle from external services. */
    async handleCameraBecameOffline(cameraId, now = Date.now()) {
        await this.healthMonitor.handleCameraBecameOffline(cameraId, now);
        return this.getRecordingStatus(cameraId);
    }
    /** @internal — call reconcileRecordingLifecycle from external services. */
    async handleCameraBecameOnline(cameraId, now = Date.now(), opts = {}) {
        const result = await this.healthMonitor.handleCameraBecameOnline(cameraId, now, opts);
        return result ?? this.getRecordingStatus(cameraId);
    }
    async tickHealthMonitoring(now = Date.now()) { return this.healthMonitor.tick(now); }
    updateRecordingDataTime(cameraId) { this.healthMonitor.updateLastDataAt(cameraId); }

    /**
     * Start recording untuk camera
     */
    async startRecording(cameraId) {
        try {
            // Check if already recording
            if (recordingProcessManager.getStatus(cameraId).status !== 'stopped') {
                console.log(`Camera ${cameraId} already recording`);
                return { success: false, message: 'Already recording' };
            }

            // Get camera data
            const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [cameraId]);
            const prepared = prepareRecordingStart({ camera, recordingsBasePath: RECORDINGS_BASE_PATH });
            if (!prepared.success) {
                if (prepared.reason) {
                    console.error(`[Recording] Invalid source for camera ${cameraId}: ${prepared.message}`);
                }
                return prepared;
            }
            const { sourceConfig, ffmpegArgs, spawnOptions, recordingTimezone } = prepared;

            console.log(`Starting recording for camera ${cameraId} (${camera.name})`);
            console.log(`[Recording] Source type: ${sourceConfig.streamSource}`);
            console.log(`[Recording] Input URL: ${sourceConfig.logSource}`);
            console.log('FFmpeg recording: stream copy with web-compatible MP4 (0% CPU overhead)');
            console.log(`[Recording] Segment filename timezone: ${recordingTimezone}`);

            const startResult = await recordingProcessManager.start(cameraId, {
                ffmpegArgs,
                camera,
                streamSource: sourceConfig.streamSource,
                spawnOptions,
                onStdout: () => this.updateRecordingDataTime(cameraId),
                onStderr: (output) => this.handleRecordingStderr(cameraId, output),
                onError: (error) => {
                    console.error(`FFmpeg spawn error for camera ${cameraId}:`, error);
                    this.markRecordingFailure(cameraId, 'spawn_error');
                },
                onClose: (result) => this.handleRecordingClosed(cameraId, result, sourceConfig.streamSource),
            });

            if (!startResult.success) {
                return startResult;
            }

            // Initialize stream health. Spawning is not proof of recovery — the
            // failure counter is only cleared once data has flowed for a sustained
            // window (see recordingHealthMonitor), so a no-media camera can't reset
            // the circuit-breaker by restarting.
            this.markRecordingStarted(cameraId, Date.now());

            // Update camera status
            execute(
                'UPDATE cameras SET recording_status = ?, last_recording_start = ? WHERE id = ?',
                ['recording', new Date().toISOString(), cameraId]
            );

            console.log(`✓ Started recording for camera ${cameraId}`);
            return { success: true, message: 'Recording started' };

        } catch (error) {
            console.error(`Error starting recording for camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Stop recording untuk camera
     */
    async stopRecording(cameraId, options = {}) {
        try {
            const shouldRemoveHealthState = options.removeHealthState !== false;
            const reason = options.reason ?? 'manual_stop';
            const activeStatus = recordingProcessManager.getStatus(cameraId);
            if (activeStatus.status === 'stopped') {
                return { success: false, message: 'Not recording' };
            }

            await recordingProcessManager.stop(cameraId, reason);
            if (shouldRemoveHealthState) {
                this.clearRuntimeHealthState(cameraId);
            }

            // Update camera status
            execute(
                'UPDATE cameras SET recording_status = ? WHERE id = ?',
                ['stopped', cameraId]
            );

            console.log(`✓ Stopped recording for camera ${cameraId}`);
            return { success: true, message: 'Recording stopped' };

        } catch (error) {
            console.error(`Error stopping recording for camera ${cameraId}:`, error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Restart recording (untuk auto-restart)
     */
    async restartRecording(cameraId, reason = 'manual') {
        console.log(`Restarting recording for camera ${cameraId}, reason: ${reason}`);

        const restartTime = new Date();
        const health = this.ensureRuntimeHealthState(cameraId);
        health.lastRestartAt = restartTime.getTime();

        // Stop current recording
        await this.stopRecording(cameraId, {
            removeHealthState: reason === 'manual',
            reason: reason === 'manual' ? 'manual_restart' : `${reason}_restart`,
        });

        // Wait 3 seconds
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Start recording again
        const result = await this.startRecording(cameraId);
        if (!result.success && reason !== 'manual') {
            this.markRecordingFailure(cameraId, reason, Date.now());
        }

        // Log restart event
        const recoveryTime = new Date();
        this.logRestart(cameraId, reason, result.success, restartTime, recoveryTime);

        return result;
    }

    handleRecordingStderr(cameraId, output) {
        this.updateRecordingDataTime(cameraId);
        const parsed = parseRecordingStderrLine(output);

        if (parsed.kind === 'segment_completed') {
            console.log(`[FFmpeg] Detected segment completion (CLOSING): ${parsed.filename}`);
            this.onSegmentCreated(cameraId, parsed.filename);
        } else if (parsed.kind === 'segment_debug') {
            console.log(`[FFmpeg Segment Debug] ${parsed.logLine}`);
        } else if (parsed.kind === 'error') {
            console.error(`[FFmpeg Camera ${cameraId}] ${parsed.logLine}`);
        }
    }

    handleRecordingClosed(cameraId, result, streamSource) {
        if (['intentional_stop', 'intentional_shutdown', 'restart_requested', 'not_recording'].includes(result.reason)) {
            console.log(`FFmpeg process for camera ${cameraId} stopped with lifecycle reason: ${result.reason}`);
            return;
        }

        console.error(`FFmpeg process for camera ${cameraId} exited with code ${result.exitCode}`);
        console.error(`[Recording] Failure reason (${streamSource}): ${result.reason}`);
        console.error(`Last FFmpeg output:\n${recordingProcessManager.getOutput(cameraId).slice(-1000)}`);
        this.markRecordingFailure(cameraId, result.reason);
        this.logRestart(cameraId, 'process_crashed', false);
    }

    onSegmentCreated(cameraId, filename) {
        const source = resolveSegmentSource(RECORDINGS_BASE_PATH, cameraId, filename);
        if (!source) {
            console.warn(`[Segment] Invalid filename format: ${filename}`);
            return;
        }

        if (recordingRecoveryService.isFileOwned(cameraId, source.finalFilename)) {
            console.log(`[Segment] Already processing: ${source.finalFilename}, skipping duplicate`);
            return;
        }

        console.log(`[Segment] Enqueue recovery: camera${cameraId}/${filename}`);
        recordingRecoveryService.enqueueRecovery({
            cameraId,
            filename,
            sourcePath: source.sourcePath,
            sourceType: source.sourceType,
        });
    }
    async cleanupOldSegments(cameraId) {
        return this.maintenanceCoordinator.cleanupOldSegments(cameraId);
    }

    /**
     * Log restart event
     */
    logRestart(cameraId, reason, success = true, restartTime = new Date(), recoveryTime = null) {
        try {
            execute(
                `INSERT INTO restart_logs 
                (camera_id, reason, restart_time, recovery_time, success) 
                VALUES (?, ?, ?, ?, ?)`,
                [
                    cameraId,
                    reason,
                    restartTime.toISOString(),
                    recoveryTime ? recoveryTime.toISOString() : null,
                    success ? 1 : 0
                ]
            );
        } catch (error) {
            console.error('Error logging restart:', error);
        }
    }

    async reconcileRecordingLifecycle(cameraId, reason = 'manual', now = Date.now()) {
        return this.lifecycleReconciler.reconcileCamera(cameraId, reason, now);
    }

    async reconcileRecordingLifecycleAll(reason = 'periodic_safety_net', now = Date.now()) {
        return this.lifecycleReconciler.reconcileAll(reason, now);
    }

    async shutdown() {
        this.isShuttingDown = true;
        this.healthMonitor?.stop();
        this.scheduler?.stop();
        const results = await recordingProcessManager.shutdownAll('server_shutdown');
        await recordingRecoveryService.drain(30000);
        const drainResult = await recordingSegmentFinalizer.drain(30000);
        if (!drainResult.drained) {
            console.warn(`[Shutdown] Recording finalizer drain timed out with ${drainResult.pending} pending file(s)`);
        }
        const cleanupDrain = await cleanupService.drain(10000);
        if (!cleanupDrain.drained) {
            console.warn(`[Shutdown] Cleanup service drain timed out with ${cleanupDrain.pending} camera(s) still cleaning`);
        }
        await this.maintenanceCoordinator.drainAll(10000);
        return results;
    }

    attachScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    initializeBackgroundWork() {
        if (!this.scheduler) {
            // Legacy fallback path: no scheduler attached, schedule manually with raw timers.
            // Production goes through scheduler.register() below for telemetry.
            this.maintenanceCoordinator.startLegacyTimers();
            return;
        }
        this.maintenanceCoordinator.registerSchedulerTasks(this.scheduler);
        this.scheduler.start();
    }

    // Backwards-compatible delegating wrappers. Production uses scheduler.register
    // via initializeBackgroundWork; these are kept so existing tests can drive
    // scheduling manually via scheduleTimeout.
    startSegmentScanner(scheduleTimeout = setTimeout) {
        const scanner = this.maintenanceCoordinator.ensureRecoveryScanner();
        const cycle = async () => {
            await scanner.scanOnce();
            scheduleTimeout(cycle, scanner.intervalMs);
        };
        scheduleTimeout(cycle, scanner.intervalMs);
    }

    startBackgroundCleanup(scheduleTimeout = setTimeout) {
        const bg = this.maintenanceCoordinator.ensureBackgroundCleanupService();
        const buildCycle = async () => { await bg.buildQueue(); scheduleTimeout(buildCycle, bg.buildIntervalMs); };
        const processCycle = async () => { await bg.processOneQueueItem(); scheduleTimeout(processCycle, bg.processIntervalMs); };
        scheduleTimeout(buildCycle, bg.buildInitialDelayMs);
        scheduleTimeout(processCycle, bg.processIntervalMs);
    }

    startScheduledCleanup(scheduleTimeout = setTimeout) {
        const cycle = async () => {
            await this.maintenanceCoordinator.runScheduledCleanup();
            scheduleTimeout(cycle, SCHEDULED_CLEANUP_INTERVAL_MS);
        };
        scheduleTimeout(cycle, SCHEDULED_CLEANUP_INITIAL_DELAY_MS);
    }

    startLifecycleReconciler(scheduleTimeout = setTimeout) {
        const cycle = async () => {
            try {
                if (!this.isShuttingDown) {
                    await this.reconcileRecordingLifecycleAll('periodic_safety_net');
                }
            } catch (error) {
                console.error('[RecordingReconciler] Error during lifecycle reconciliation:', error.message);
            } finally {
                scheduleTimeout(cycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
            }
        };
        scheduleTimeout(cycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
    }

    /**
     * Get recording status
     */
    getRecordingStatus(cameraId) {
        const recording = recordingProcessManager.getStatus(cameraId);
        const health = this.healthMonitor.getState(cameraId);

        if (recording.status === 'stopped') {
            if (health?.suspendedReason) {
                return {
                    isRecording: false,
                    status: health.suspendedReason === 'camera_offline' ? 'suspended_offline' : 'waiting_retry',
                    restartCount: health.restartCount || 0,
                    consecutiveFailureCount: health.consecutiveFailureCount || 0,
                    cooldownUntil: health.cooldownUntil || 0,
                    suspendedReason: health.suspendedReason,
                };
            }

            return {
                isRecording: false,
                status: 'stopped'
            };
        }

        return {
            isRecording: recording.isRecording,
            status: recording.status,
            startTime: recording.startTime,
            duration: recording.startTime ? Math.floor((Date.now() - recording.startTime.getTime()) / 1000) : 0,
            restartCount: health ? health.restartCount : 0,
            consecutiveFailureCount: health ? health.consecutiveFailureCount || 0 : 0,
            cooldownUntil: health ? health.cooldownUntil || 0 : 0,
            suspendedReason: health ? health.suspendedReason || null : null,
        };
    }

    /**
     * Get storage usage per camera
     */
    getStorageUsage(cameraId) {
        try {
            const result = queryOne(
                'SELECT SUM(file_size) as total_size, COUNT(*) as segment_count FROM recording_segments WHERE camera_id = ?',
                [cameraId]
            );

            return {
                totalSize: result.total_size || 0,
                segmentCount: result.segment_count || 0,
                totalSizeGB: ((result.total_size || 0) / 1024 / 1024 / 1024).toFixed(2)
            };
        } catch (error) {
            console.error('Error getting storage usage:', error);
            return { totalSize: 0, segmentCount: 0, totalSizeGB: '0.00' };
        }
    }


    getEmergencyDiskService() {
        return this.maintenanceCoordinator.getEmergencyDiskService();
    }

    async emergencyDiskSpaceCheck() {
        return this.maintenanceCoordinator.runEmergencyDiskCheck();
    }

    async autoStartRecordings() {
        return this.autoStarter.autoStart();
    }
}

// Export singleton instance
export const recordingService = new RecordingService();
export { RecordingService };
