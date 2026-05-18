// Purpose: Coordinate recording facade behavior, DB state, health recovery, and segment processing.
// Caller: recording routes, camera health service, server shutdown lifecycle.
// Deps: FFmpeg process manager, SQLite connection pool, filesystem, camera delivery utilities, lifecycle reconciler.
// MainFuncs: startRecording, stopRecording, restartRecording, shutdown, getRecordingStatus, reconcileRecordingLifecycleAll.
// SideEffects: Starts/stops FFmpeg via process manager, updates DB state, remuxes segment files, quarantines expired invalid files.

import { existsSync, mkdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import { buildFfmpegRtspInputArgs, resolveInternalRtspTransport } from '../utils/internalRtspTransportPolicy.js';
import recordingProcessManager from './recordingProcessManager.js';
import { createRecordingCleanupService } from './recordingCleanupService.js';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import recordingRecoveryService from './recordingRecoveryService.js';
import recordingFileOperationService from './recordingFileOperationService.js';
import { buildRecordingProcessEnv, getRecordingProcessTimezone } from './recordingProcessTimePolicy.js';
import { createRecordingRecoveryScanner } from './recordingRecoveryScanner.js';
import { createRecordingLifecycleReconciler } from './recordingLifecycleReconciler.js';
import recordingDiskSpaceService from './recordingDiskSpaceService.js';
import { createRecordingEmergencyDiskService } from './recordingEmergencyDiskService.js';
import { createRecordingBackgroundCleanupService } from './recordingBackgroundCleanupService.js';
import {
    getCameraRecordingDir as getPolicyCameraRecordingDir,
    getFinalRecordingPath,
    getPendingRecordingDir,
    getPendingRecordingPattern,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
import { RECORDINGS_BASE_PATH } from './recordingPaths.js';
import {
    RECORDING_HEALTH_TICK_INTERVAL_MS,
    RECORDING_HEALTH_TIMEOUT_INTERNAL_MS,
    RECORDING_HEALTH_TIMEOUT_TUNNEL_MS,
    RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
    RECORDING_OFFLINE_COOLDOWN_MS,
    RECORDING_RETRY_BASE_COOLDOWN_MS,
    RECORDING_RETRY_MAX_COOLDOWN_MS,
    RECORDING_FAILURE_SUSPEND_THRESHOLD,
    RECORDING_SCHEDULED_CLEANUP_INITIAL_DELAY_MS as SCHEDULED_CLEANUP_INITIAL_DELAY_MS,
    RECORDING_SCHEDULED_CLEANUP_INTERVAL_MS as SCHEDULED_CLEANUP_INTERVAL_MS,
} from './recordingIntervalsPolicy.js';
const execPromise = promisify(exec);

// Stream health monitoring
const streamHealthMap = new Map();

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

const EXTERNAL_RECORDING_PROTOCOL_WHITELIST = 'file,http,https,tcp,tls,crypto';

export function computeRecordingCooldownMs(consecutiveFailureCount = 0) {
    if (consecutiveFailureCount <= 1) {
        return RECORDING_RETRY_BASE_COOLDOWN_MS;
    }

    const exponent = Math.max(0, consecutiveFailureCount - 1);
    return Math.min(
        RECORDING_RETRY_BASE_COOLDOWN_MS * (2 ** exponent),
        RECORDING_RETRY_MAX_COOLDOWN_MS
    );
}

export function maskRecordingSourceForLog(sourceUrl) {
    if (!sourceUrl) return '';

    try {
        const url = new URL(sourceUrl);
        if (url.username || url.password) {
            url.username = '****';
            url.password = '****';
        }

        if (url.search) {
            for (const [key] of url.searchParams.entries()) {
                url.searchParams.set(key, '***');
            }
        }

        return url.toString();
    } catch {
        return sourceUrl.replace(/:[^:@]+@/, ':****@');
    }
}

export function getRecordingSourceConfig(camera) {
    const deliveryType = getEffectiveDeliveryType(camera);
    const streamSource = deliveryType === 'internal_hls' ? 'internal' : 'external';

    if (deliveryType === 'external_hls') {
        const externalUrl = (getPrimaryExternalStreamUrl(camera) || '').trim();
        if (!externalUrl) {
            return {
                success: false,
                reason: 'invalid_source',
                message: 'External HLS URL is required for external recording',
            };
        }

        if (!/^https?:\/\//i.test(externalUrl)) {
            return {
                success: false,
                reason: 'invalid_source',
                message: 'Invalid external HLS URL',
            };
        }

        return {
            success: true,
            streamSource,
            inputUrl: externalUrl,
            logSource: maskRecordingSourceForLog(externalUrl),
        };
    }

    if (deliveryType !== 'internal_hls') {
        return {
            success: false,
            reason: 'unsupported_source',
            message: 'Playback recording only supports internal HLS or external HLS cameras',
        };
    }

    const rtspUrl = (camera?.private_rtsp_url || '').trim();
    if (!rtspUrl || !/^rtsp:\/\//i.test(rtspUrl)) {
        return {
            success: false,
            reason: 'invalid_source',
            message: 'Invalid RTSP URL',
        };
    }

    return {
        success: true,
        streamSource,
        inputUrl: rtspUrl,
        logSource: maskRecordingSourceForLog(rtspUrl),
        rtspTransport: resolveInternalRtspTransport(camera),
    };
}

export function buildRecordingFfmpegArgs({ cameraDir, outputPattern, inputUrl, streamSource, rtspTransport = 'tcp' }) {
    const resolvedOutputPattern = outputPattern || join(cameraDir, '%Y%m%d_%H%M%S.mp4');
    const inputArgs = streamSource === 'external'
        ? [
            '-protocol_whitelist', EXTERNAL_RECORDING_PROTOCOL_WHITELIST,
            '-i', inputUrl,
        ]
        : buildFfmpegRtspInputArgs(inputUrl, rtspTransport);

    return [
        ...inputArgs,
        '-map', '0:v',
        '-c:v', 'copy',
        '-an',
        '-f', 'segment',
        '-segment_time', '600',
        '-segment_format', 'mp4',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-segment_atclocktime', '1',
        '-reset_timestamps', '1',
        '-strftime', '1',
        resolvedOutputPattern
    ];
}

export function classifyRecordingFailure(ffmpegOutput = '', streamSource = 'internal') {
    const output = ffmpegOutput.toLowerCase();

    if (output.includes('http error 403') || output.includes('forbidden') || output.includes('access denied')) {
        return 'upstream_unreachable';
    }
    if (output.includes('404 not found') || output.includes('server returned 404')) {
        return 'upstream_unreachable';
    }
    if (output.includes('connection refused') || output.includes('connection timed out') || output.includes('timed out')) {
        return 'upstream_unreachable';
    }
    if (streamSource === 'external' && (output.includes('invalid data found') || output.includes('failed to open segment') || output.includes('error when loading first segment'))) {
        return 'unsupported_playlist';
    }
    if (output.includes('invalid argument') || output.includes('protocol not found') || output.includes('no such file or directory')) {
        return 'invalid_source';
    }

    return 'ffmpeg_failed';
}

/**
 * Recording Service
 * Handles CCTV recording dengan stream copy (no re-encoding)
 */
class RecordingService {
    constructor() {
        this.isShuttingDown = false;
        this.scheduler = null;
        this.emergencyDiskService = null;
        this.backgroundCleanupService = null;

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

        // Start health monitoring
        this.startHealthMonitoring();
    }

    ensureRuntimeHealthState(cameraId) {
        const existingState = streamHealthMap.get(cameraId);
        if (existingState) {
            return existingState;
        }

        const nextState = {
            lastDataTime: Date.now(),
            restartCount: 0,
            consecutiveFailureCount: 0,
            cooldownUntil: 0,
            suspendedReason: null,
            lastRestartAt: null,
            inFlightAction: false,
        };

        streamHealthMap.set(cameraId, nextState);
        return nextState;
    }

    clearRuntimeHealthState(cameraId) {
        streamHealthMap.delete(cameraId);
    }

    markRecordingRecovered(cameraId, now = Date.now()) {
        const health = this.ensureRuntimeHealthState(cameraId);
        health.lastDataTime = now;
        health.consecutiveFailureCount = 0;
        health.cooldownUntil = 0;
        health.suspendedReason = null;
        health.inFlightAction = false;
        return health;
    }

    markRecordingFailure(cameraId, reason = 'process_crashed', now = Date.now()) {
        const health = this.ensureRuntimeHealthState(cameraId);
        health.consecutiveFailureCount += 1;
        health.lastRestartAt = now;
        health.inFlightAction = false;

        const cooldownMs = computeRecordingCooldownMs(health.consecutiveFailureCount);
        health.cooldownUntil = now + cooldownMs;
        health.suspendedReason = health.consecutiveFailureCount >= RECORDING_FAILURE_SUSPEND_THRESHOLD
            ? 'waiting_retry'
            : reason;

        return health;
    }

    suspendRecordingForOffline(cameraId, now = Date.now()) {
        const health = this.ensureRuntimeHealthState(cameraId);
        health.cooldownUntil = Math.max(health.cooldownUntil || 0, now + RECORDING_OFFLINE_COOLDOWN_MS);
        health.suspendedReason = 'camera_offline';
        health.inFlightAction = false;
        return health;
    }

    async attemptRecordingRecovery(cameraId, reason = 'waiting_retry', now = Date.now()) {
        const health = this.ensureRuntimeHealthState(cameraId);
        if (health.inFlightAction || now < (health.cooldownUntil || 0)) {
            return { success: false, skipped: true, reason: 'cooldown_active' };
        }

        health.inFlightAction = true;

        try {
            const result = await this.startRecording(cameraId);
            if (result.success) {
                this.markRecordingRecovered(cameraId, now);
            } else {
                this.markRecordingFailure(cameraId, reason, now);
            }
            return result;
        } finally {
            const latestHealth = streamHealthMap.get(cameraId);
            if (latestHealth) {
                latestHealth.inFlightAction = false;
            }
        }
    }

    async handleCameraBecameOffline(cameraId, now = Date.now()) {
        this.suspendRecordingForOffline(cameraId, now);

        if (recordingProcessManager.getStatus(cameraId).status !== 'stopped') {
            await this.stopRecording(cameraId, { removeHealthState: false, reason: 'camera_offline' });
        }

        return this.getRecordingStatus(cameraId);
    }

    async handleCameraBecameOnline(cameraId, now = Date.now(), { clearCooldown = true } = {}) {
        if (recordingProcessManager.getStatus(cameraId).status !== 'stopped') {
            return this.getRecordingStatus(cameraId);
        }

        const health = this.ensureRuntimeHealthState(cameraId);
        if (!health.suspendedReason) {
            health.suspendedReason = 'waiting_retry';
        }
        if (clearCooldown) {
            health.cooldownUntil = 0;
        }

        return this.attemptRecordingRecovery(cameraId, health.suspendedReason, now);
    }

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
            if (!camera) {
                return { success: false, message: 'Camera not found' };
            }

            const sourceConfig = getRecordingSourceConfig(camera);
            if (!sourceConfig.success) {
                console.error(`[Recording] Invalid source for camera ${cameraId}: ${sourceConfig.message}`);
                return { success: false, message: sourceConfig.message, reason: sourceConfig.reason };
            }

            // Check if camera is enabled
            if (!camera.enabled) {
                return { success: false, message: 'Camera is disabled' };
            }

            // Check if recording is enabled
            if (!camera.enable_recording) {
                return { success: false, message: 'Recording not enabled for this camera' };
            }

            // Create camera recording directory
            const cameraDir = getPolicyCameraRecordingDir(RECORDINGS_BASE_PATH, cameraId);
            const pendingDir = getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId);
            mkdirSync(cameraDir, { recursive: true });
            mkdirSync(pendingDir, { recursive: true });

            console.log(`Starting recording for camera ${cameraId} (${camera.name})`);
            console.log(`[Recording] Source type: ${sourceConfig.streamSource}`);
            console.log(`[Recording] Input URL: ${sourceConfig.logSource}`);

            // FFmpeg command - stream copy with optimized MP4 for seeking
            const ffmpegArgs = buildRecordingFfmpegArgs({
                cameraDir,
                outputPattern: getPendingRecordingPattern(RECORDINGS_BASE_PATH, cameraId),
                inputUrl: sourceConfig.inputUrl,
                streamSource: sourceConfig.streamSource,
                rtspTransport: sourceConfig.rtspTransport,
            });

            console.log(`FFmpeg recording: stream copy with web-compatible MP4 (0% CPU overhead)`);
            const recordingTimezone = getRecordingProcessTimezone();
            console.log(`[Recording] Segment filename timezone: ${recordingTimezone}`);

            const startResult = await recordingProcessManager.start(cameraId, {
                ffmpegArgs,
                camera,
                streamSource: sourceConfig.streamSource,
                spawnOptions: {
                    env: buildRecordingProcessEnv(process.env, recordingTimezone),
                },
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

            // Initialize stream health
            this.markRecordingRecovered(cameraId, Date.now());

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

    updateRecordingDataTime(cameraId) {
        const health = streamHealthMap.get(cameraId);
        if (health) {
            health.lastDataTime = Date.now();
        }
    }

    handleRecordingStderr(cameraId, output) {
        this.updateRecordingDataTime(cameraId);

        // Detect segment completion only on "Closing" so remux never touches files still being written.
        if (output.includes('Closing') && output.includes('.mp4')) {
            const match = output.match(/(\d{8}_\d{6}\.mp4(?:\.partial)?)/);
            if (match) {
                const filename = match[1];
                console.log(`[FFmpeg] Detected segment completion (CLOSING): ${filename}`);
                this.onSegmentCreated(cameraId, filename);
            }
        }

        if (output.includes('.mp4') && (output.includes('segment') || output.includes('Opening') || output.includes('Closing'))) {
            console.log(`[FFmpeg Segment Debug] ${output.trim()}`);
        }

        if ((output.includes('error') || output.includes('Error') || output.includes('failed')) && !output.includes('Closing')) {
            console.error(`[FFmpeg Camera ${cameraId}] ${output.trim()}`);
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

    /**
     * Handle segment creation
     */
    onSegmentCreated(cameraId, filename) {
        const finalFilename = toFinalSegmentFilename(filename);
        if (!finalFilename) {
            console.warn(`[Segment] Invalid filename format: ${filename}`);
            return;
        }

        if (recordingRecoveryService.isFileOwned(cameraId, finalFilename)) {
            console.log(`[Segment] Already processing: ${finalFilename}, skipping duplicate`);
            return;
        }

        const sourceType = isPartialSegmentFilename(filename) ? 'partial' : 'final_orphan';
        const sourcePath = sourceType === 'partial'
            ? join(getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId), filename)
            : getFinalRecordingPath(RECORDINGS_BASE_PATH, cameraId, finalFilename);

        console.log(`[Segment] Enqueue recovery: camera${cameraId}/${filename}`);
        recordingRecoveryService.enqueueRecovery({
            cameraId,
            sourcePath,
            filename,
            sourceType,
        });
    }
    /**
     * Cleanup old segments - AGE-BASED (FINAL FIX)
     * CRITICAL: Delete based on FILE AGE, not segment count
     * This prevents premature deletion of recent files
     * 
     * ⚡ FIX 2: NON-BLOCKING CLEANUP - Uses async operations to prevent Event Loop freeze
     * ⚡ FIX 6: Also cleans FILESYSTEM ORPHANS (files on disk but not in DB)
     */
    async cleanupOldSegments(cameraId) {
        try {
            const camera = queryOne('SELECT recording_duration_hours, name FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) {
                console.log(`[Cleanup] Camera ${cameraId} not found, skipping cleanup`);
                return;
            }

            return await cleanupService.cleanupCamera({
                cameraId,
                camera,
                nowMs: Date.now(),
            });
        } catch (error) {
            console.error(`[Cleanup] Error cleaning up camera ${cameraId}:`, error);
        }
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

    /**
     * Health monitoring - check stream health setiap 5 detik
     */
    startHealthMonitoring() {
        setInterval(() => {
            this.tickHealthMonitoring().catch((error) => {
                console.error('[Recording Health] Error during monitor tick:', error);
            });
        }, RECORDING_HEALTH_TICK_INTERVAL_MS);
    }

    async tickHealthMonitoring(now = Date.now()) {
        if (this.isShuttingDown) {
            return;
        }

        for (const [cameraId, health] of streamHealthMap.entries()) {
            const camera = queryOne(
                'SELECT is_tunnel, is_online, enabled, enable_recording, recording_status FROM cameras WHERE id = ?',
                [cameraId]
            );

            if (!camera) {
                this.clearRuntimeHealthState(cameraId);
                continue;
            }

            if (!camera.enabled || !camera.enable_recording) {
                if (recordingProcessManager.getStatus(cameraId).status === 'stopped') {
                    this.clearRuntimeHealthState(cameraId);
                }
                continue;
            }

            const activeRecording = recordingProcessManager.getStatus(cameraId);
            if (activeRecording.status === 'stopped') {
                if (camera.is_online === 1 && health.suspendedReason && now >= (health.cooldownUntil || 0)) {
                    await this.attemptRecordingRecovery(cameraId, health.suspendedReason, now);
                } else if (camera.is_online !== 1) {
                    this.suspendRecordingForOffline(cameraId, now);
                }
                continue;
            }

            if (health.inFlightAction) {
                continue;
            }

            const timeout = camera.is_tunnel === 1
                ? RECORDING_HEALTH_TIMEOUT_TUNNEL_MS
                : RECORDING_HEALTH_TIMEOUT_INTERNAL_MS;
            const timeSinceData = now - health.lastDataTime;
            if (timeSinceData <= timeout) {
                continue;
            }

            if (camera.is_online !== 1) {
                console.log(`[Recording Health] Camera ${cameraId} confirmed offline, suspending recording recovery`);
                this.suspendRecordingForOffline(cameraId, now);
                await this.stopRecording(cameraId, { removeHealthState: false });
                continue;
            }

            if (now < (health.cooldownUntil || 0)) {
                continue;
            }

            console.log(`⚠️ Camera ${cameraId} stream frozen (${timeSinceData}ms), restarting...`);
            health.restartCount += 1;
            health.lastRestartAt = now;
            health.inFlightAction = true;

            try {
                await this.restartRecording(cameraId, 'stream_frozen');
            } finally {
                const latestHealth = streamHealthMap.get(cameraId);
                if (latestHealth) {
                    latestHealth.inFlightAction = false;
                }
            }
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
        if (this.backgroundCleanupService) {
            await this.backgroundCleanupService.drain(10000);
        }
        if (this.emergencyDiskService) {
            await this.emergencyDiskService.drain(10000);
        }
        return results;
    }

    attachScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    initializeBackgroundWork() {
        this._ensureRecoveryScanner();
        this._ensureBackgroundCleanupService();

        if (!this.scheduler) {
            // Legacy fallback path: no scheduler attached, schedule manually with raw timers.
            // Production goes through scheduler.register() below for telemetry.
            this._startLegacyTimers();
            return;
        }

        this.scheduler.register({
            name: 'segment_scanner',
            task: () => this.recoveryScanner.scanOnce(),
            intervalMs: this.recoveryScanner.intervalMs,
            initialDelayMs: this.recoveryScanner.intervalMs,
        });
        this.scheduler.register({
            name: 'bg_cleanup_build',
            task: () => this.backgroundCleanupService.buildQueue(),
            intervalMs: this.backgroundCleanupService.buildIntervalMs,
            initialDelayMs: this.backgroundCleanupService.buildInitialDelayMs,
        });
        this.scheduler.register({
            name: 'bg_cleanup_process',
            task: () => this.backgroundCleanupService.processOneQueueItem(),
            intervalMs: this.backgroundCleanupService.processIntervalMs,
            initialDelayMs: this.backgroundCleanupService.processIntervalMs,
        });
        this.scheduler.register({
            name: 'scheduled_cleanup',
            task: () => this._runScheduledCleanup(),
            intervalMs: SCHEDULED_CLEANUP_INTERVAL_MS,
            initialDelayMs: SCHEDULED_CLEANUP_INITIAL_DELAY_MS,
        });
        this.scheduler.register({
            name: 'lifecycle_reconciler',
            task: async () => {
                if (this.isShuttingDown) return;
                await this.reconcileRecordingLifecycleAll('periodic_safety_net');
            },
            intervalMs: RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
            initialDelayMs: RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS,
        });
        this.scheduler.start();
    }

    _startLegacyTimers(scheduleTimeout = setTimeout) {
        this.startSegmentScanner(scheduleTimeout);
        this.startBackgroundCleanup(scheduleTimeout);
        this.startScheduledCleanup(scheduleTimeout);
        this.startLifecycleReconciler(scheduleTimeout);
    }

    // Backwards-compatible timer entrypoints used by unit tests that simulate
    // scheduling directly. Production code uses scheduler.register() above.
    startSegmentScanner(scheduleTimeout = setTimeout) {
        this._ensureRecoveryScanner();
        const cycle = async () => {
            await this.recoveryScanner.scanOnce();
            scheduleTimeout(cycle, this.recoveryScanner.intervalMs);
        };
        scheduleTimeout(cycle, this.recoveryScanner.intervalMs);
    }

    startBackgroundCleanup(scheduleTimeout = setTimeout) {
        this._ensureBackgroundCleanupService();
        const buildCycle = async () => {
            await this.backgroundCleanupService.buildQueue();
            scheduleTimeout(buildCycle, this.backgroundCleanupService.buildIntervalMs);
        };
        const processCycle = async () => {
            await this.backgroundCleanupService.processOneQueueItem();
            scheduleTimeout(processCycle, this.backgroundCleanupService.processIntervalMs);
        };
        scheduleTimeout(buildCycle, this.backgroundCleanupService.buildInitialDelayMs);
        scheduleTimeout(processCycle, this.backgroundCleanupService.processIntervalMs);
    }

    startScheduledCleanup(scheduleTimeout = setTimeout) {
        const cycle = async () => {
            await this._runScheduledCleanup();
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

    _ensureRecoveryScanner() {
        if (!this.recoveryScanner) {
            this.recoveryScanner = createRecordingRecoveryScanner({
                recordingsBasePath: RECORDINGS_BASE_PATH,
                onSegmentCreated: (cameraId, filename) => this.onSegmentCreated(cameraId, filename),
                logger: console,
            });
        }
    }

    _ensureBackgroundCleanupService() {
        if (!this.backgroundCleanupService) {
            this.backgroundCleanupService = createRecordingBackgroundCleanupService({
                recordingsBasePath: RECORDINGS_BASE_PATH,
                fs: fsPromises,
                query,
                queryOne,
                ffprobe: (filePath) => execPromise(`ffprobe -v error "${filePath}"`, { timeout: 3000 }),
                onSegmentCreated: (cameraId, filename) => this.onSegmentCreated(cameraId, filename),
                logger: console,
            });
        }
    }

    async _runScheduledCleanup() {
        try {
            const enabledCameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
            const allCameraIds = new Set(enabledCameras.map((c) => c.id));

            try {
                await fsPromises.access(RECORDINGS_BASE_PATH);
                const dirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
                for (const d of dirs) {
                    const match = d.match(/camera(\d+)/);
                    if (match) allCameraIds.add(parseInt(match[1], 10));
                }
            } catch { /* recordings dir missing — OK */ }

            console.log(`[Cleanup] Running scheduled cleanup for ${allCameraIds.size} cameras...`);
            for (const cameraId of allCameraIds) {
                await this.cleanupOldSegments(cameraId);
            }

            await this.emergencyDiskSpaceCheck();
            console.log('[Cleanup] Scheduled cleanup complete');
        } catch (error) {
            console.error('[Cleanup] Scheduled cleanup error:', error);
        }
    }

    /**
     * Get recording status
     */
    getRecordingStatus(cameraId) {
        const recording = recordingProcessManager.getStatus(cameraId);
        const health = streamHealthMap.get(cameraId);

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
        if (!this.emergencyDiskService) {
            this.emergencyDiskService = createRecordingEmergencyDiskService({
                recordingsBasePath: RECORDINGS_BASE_PATH,
                cleanupService,
                diskSpaceService: recordingDiskSpaceService,
                fs: fsPromises,
                safeDelete: recordingFileOperationService.deleteFileSafely,
                getCameraRetentionHours: (cameraId) => {
                    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                    return camera?.recording_duration_hours;
                },
                onRecoverOrphan: ({ cameraId, filename }) => this.onSegmentCreated(cameraId, filename),
                logger: console,
            });
        }

        return this.emergencyDiskService;
    }

    /**
     * Emergency disk space check
     * If available space is below 1GB, aggressively delete oldest files
     */
    async emergencyDiskSpaceCheck() {
        return this.getEmergencyDiskService().runEmergencyCheck();
    }

    /**
     * Auto-start recordings on service init.
     * Delegates to the lifecycle reconciler so policy (offline suspension, cooldown,
     * delivery type, eligibility) lives in one place. The periodic reconciler will
     * retry every 60s for cameras that failed first attempt. Offline cameras are
     * pre-marked as suspended so the assurance UI reflects state immediately.
     */
    async autoStartRecordings() {
        try {
            const offlineCameras = query(
                'SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1 AND COALESCE(is_online, 1) != 1'
            );
            for (const camera of offlineCameras) {
                this.suspendRecordingForOffline(camera.id);
            }

            const result = await this.reconcileRecordingLifecycleAll('auto_start');
            const started = result.results.filter((r) => r.action === 'start' && r.success).length;
            const skipped = result.results.length - started;
            console.log(`[Recording] Auto-start complete: ${started} started, ${skipped} skipped (offline/cooldown/disabled)`);
        } catch (error) {
            console.error('[Recording] Error in auto-starting recordings:', error);
        }
    }
}

// Export singleton instance
export const recordingService = new RecordingService();
export { RecordingService };
