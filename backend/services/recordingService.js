// Purpose: Coordinate recording facade behavior, DB state, health recovery, and segment processing.
// Caller: recording routes, camera health service, server shutdown lifecycle.
// Deps: FFmpeg process manager, SQLite connection pool, filesystem, camera delivery utilities.
// MainFuncs: startRecording, stopRecording, restartRecording, shutdown, getRecordingStatus, quarantineFailedRemuxFileIfExpired.
// SideEffects: Starts/stops FFmpeg via process manager, updates DB state, remuxes segment files, quarantines expired invalid files.

import { spawn } from 'child_process';
import { existsSync, mkdirSync, unlinkSync, statSync, renameSync, readdirSync } from 'fs';
import { promises as fsPromises } from 'fs';
import { basename, isAbsolute, join, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getEffectiveDeliveryType, getPrimaryExternalStreamUrl } from '../utils/cameraDelivery.js';
import { buildFfmpegRtspInputArgs, resolveInternalRtspTransport } from '../utils/internalRtspTransportPolicy.js';
import recordingProcessManager from './recordingProcessManager.js';
import { createRecordingCleanupService } from './recordingCleanupService.js';
import { canDeleteRecordingFile, computeRetentionWindow, isSafeRecordingFilename } from './recordingRetentionPolicy.js';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import {
    getCameraRecordingDir as getPolicyCameraRecordingDir,
    getFinalRecordingPath,
    getPendingRecordingDir,
    getPendingRecordingPattern,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
const execPromise = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Base path untuk recordings
const RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');
const RECORDING_RETENTION_GRACE_MS = 10 * 60 * 1000;
const SCHEDULED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULED_CLEANUP_INITIAL_DELAY_MS = 2 * 60 * 1000;
const QUARANTINE_DIR_NAME = '.quarantine';

// Stream health monitoring
const streamHealthMap = new Map();

// CRITICAL: Track files being processed (prevent deletion during remux)
const filesBeingProcessed = new Set();

// RAM FIX: Limit concurrent re-mux operations to prevent memory spike
const MAX_CONCURRENT_REMUX = 3;
let activeRemuxCount = 0;

// Failed re-mux tracking (prevent infinite loop on corrupt files)
// Using database for persistence across restarts
const initFailedFilesTable = () => {
    try {
        execute(`
            CREATE TABLE IF NOT EXISTS failed_remux_files (
                camera_id INTEGER NOT NULL,
                filename TEXT NOT NULL,
                fail_count INTEGER DEFAULT 1,
                last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (camera_id, filename)
            )
        `);
    } catch (error) {
        console.error('[FailedFiles] Error creating table:', error);
    }
};

// Initialize table on module load
initFailedFilesTable();

// Helper functions for failed files tracking
const isFileFailed = (cameraId, filename) => {
    const result = queryOne(
        'SELECT fail_count FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
        [cameraId, filename]
    );
    return result && result.fail_count >= 3;
};

const incrementFailCount = (cameraId, filename) => {
    try {
        // Try to insert or update
        const existing = queryOne(
            'SELECT fail_count FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );

        if (existing) {
            execute(
                'UPDATE failed_remux_files SET fail_count = fail_count + 1, last_attempt = CURRENT_TIMESTAMP WHERE camera_id = ? AND filename = ?',
                [cameraId, filename]
            );
        } else {
            execute(
                'INSERT INTO failed_remux_files (camera_id, filename, fail_count) VALUES (?, ?, 1)',
                [cameraId, filename]
            );
        }
    } catch (error) {
        console.error('[FailedFiles] Error incrementing fail count:', error);
    }
};

const removeFailedFile = (cameraId, filename) => {
    try {
        execute(
            'DELETE FROM failed_remux_files WHERE camera_id = ? AND filename = ?',
            [cameraId, filename]
        );
    } catch (error) {
        console.error('[FailedFiles] Error removing failed file:', error);
    }
};

function getCameraRecordingDir(cameraId) {
    return join(RECORDINGS_BASE_PATH, `camera${cameraId}`);
}

function isPathInside(parentPath, candidatePath) {
    const parent = resolve(parentPath);
    const candidate = resolve(candidatePath);
    const pathDiff = relative(parent, candidate);
    return Boolean(pathDiff) && !pathDiff.startsWith('..') && !isAbsolute(pathDiff);
}

export function isSafeRecordingFilePath(cameraId, filePath, filename = null) {
    if (!cameraId || !filePath) {
        return false;
    }

    const cameraDir = getCameraRecordingDir(cameraId);
    const resolvedPath = resolve(filePath);

    if (!isPathInside(cameraDir, resolvedPath)) {
        return false;
    }

    if (filename && basename(resolvedPath) !== filename) {
        return false;
    }

    const fileName = filename || basename(resolvedPath);
    return isSafeRecordingFilename(fileName);
}

async function deleteRecordingFileSafely({ cameraId, filename, filePath, reason }) {
    if (!isSafeRecordingFilePath(cameraId, filePath, filename)) {
        console.warn(`[Cleanup] Refusing unsafe delete for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
        return { success: false, skipped: true, reason: 'unsafe_path', size: 0 };
    }

    try {
        const stats = await fsPromises.stat(filePath);
        await fsPromises.unlink(filePath);
        return { success: true, size: stats.size };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return { success: true, missing: true, size: 0 };
        }

        console.error(`[Cleanup] Error deleting ${filename || basename(filePath)} (${reason}):`, error.message);
        return { success: false, reason: error.message, size: 0 };
    }
}

async function quarantineRecordingFile(cameraId, filename, filePath, reason) {
    if (!isSafeRecordingFilePath(cameraId, filePath, filename)) {
        console.warn(`[Segment] Refusing unsafe quarantine for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
        return { success: false, skipped: true, reason: 'unsafe_path' };
    }

    try {
        await fsPromises.access(filePath);
    } catch {
        return { success: true, missing: true };
    }

    const quarantineDir = join(RECORDINGS_BASE_PATH, QUARANTINE_DIR_NAME, `camera${cameraId}`);
    const safeReason = String(reason || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
    const quarantineName = `${Date.now()}_${safeReason}_${filename}`;
    const quarantinePath = join(quarantineDir, quarantineName);

    try {
        await fsPromises.mkdir(quarantineDir, { recursive: true });
        await fsPromises.rename(filePath, quarantinePath);
        console.warn(`[Segment] Quarantined file: camera${cameraId}/${filename} -> ${QUARANTINE_DIR_NAME}/camera${cameraId}/${quarantineName}`);
        return { success: true, path: quarantinePath };
    } catch (error) {
        if (error.code === 'EXDEV') {
            await fsPromises.copyFile(filePath, quarantinePath);
            await fsPromises.unlink(filePath);
            console.warn(`[Segment] Quarantined file with copy fallback: camera${cameraId}/${filename}`);
            return { success: true, path: quarantinePath };
        }

        console.error(`[Segment] Failed to quarantine ${filename}:`, error.message);
        return { success: false, reason: error.message };
    }
}

async function quarantineFailedRemuxFileIfExpired(cameraId, filename, filePath, reason) {
    let fileMtimeMs = null;
    try {
        const stats = await fsPromises.stat(filePath);
        fileMtimeMs = stats.mtimeMs;
    } catch {
        fileMtimeMs = null;
    }

    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
    const retentionWindow = computeRetentionWindow({
        retentionHours: camera?.recording_duration_hours,
    });
    const deletePolicy = canDeleteRecordingFile({
        filename,
        fileMtimeMs,
        retentionWindow,
    });

    if (!deletePolicy.allowed) {
        console.warn(`[Segment] Keeping failed remux segment until retention expiry: camera${cameraId}/${filename}`);
        return { success: true, retained: true };
    }

    const result = await quarantineRecordingFile(cameraId, filename, filePath, reason);
    if (result.success) {
        removeFailedFile(cameraId, filename);
    }
    return result;
}

const cleanupService = createRecordingCleanupService({
    repository: recordingSegmentRepository,
    recordingsBasePath: RECORDINGS_BASE_PATH,
    safeDelete: deleteRecordingFileSafely,
    isFileBeingProcessed: (targetCameraId, filename) => filesBeingProcessed.has(`${targetCameraId}:${filename}`),
    onRecoverOrphan: ({ cameraId, filename, filePath, sourceType }) => recordingSegmentFinalizer.finalizeSegment({
        cameraId,
        filename,
        sourcePath: filePath,
        sourceType,
    }),
    logger: console,
});

const EXTERNAL_RECORDING_PROTOCOL_WHITELIST = 'file,http,https,tcp,tls,crypto';
const RECORDING_RETRY_BASE_COOLDOWN_MS = 15000;
const RECORDING_RETRY_MAX_COOLDOWN_MS = 5 * 60 * 1000;
const RECORDING_OFFLINE_COOLDOWN_MS = 60 * 1000;
const RECORDING_FAILURE_SUSPEND_THRESHOLD = 3;

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

        // Ensure recordings directory exists
        if (!existsSync(RECORDINGS_BASE_PATH)) {
            mkdirSync(RECORDINGS_BASE_PATH, { recursive: true });
        }

        // CRITICAL: Initialize cleanup throttle map
        this.lastCleanupTime = {};

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

    async handleCameraBecameOnline(cameraId, now = Date.now()) {
        if (recordingProcessManager.getStatus(cameraId).status !== 'stopped') {
            return this.getRecordingStatus(cameraId);
        }

        const health = this.ensureRuntimeHealthState(cameraId);
        if (!health.suspendedReason) {
            health.suspendedReason = 'waiting_retry';
        }
        health.cooldownUntil = 0;

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

            const startResult = await recordingProcessManager.start(cameraId, {
                ffmpegArgs,
                camera,
                streamSource: sourceConfig.streamSource,
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

        if (isFileFailed(cameraId, finalFilename)) {
            const failedPath = getFinalRecordingPath(RECORDINGS_BASE_PATH, cameraId, finalFilename);
            if (existsSync(failedPath)) {
                quarantineFailedRemuxFileIfExpired(cameraId, finalFilename, failedPath, 'remux_failed_3x').catch((err) => {
                    console.error(`[Segment] Failed to process failed-remux file ${finalFilename}:`, err.message);
                });
            }
            return;
        }

        const fileKey = `${cameraId}:${finalFilename}`;
        if (filesBeingProcessed.has(fileKey)) {
            console.log(`[Segment] Already processing: ${finalFilename}, skipping duplicate`);
            return;
        }

        filesBeingProcessed.add(fileKey);
        const sourceType = isPartialSegmentFilename(filename) ? 'partial' : 'final_orphan';
        const sourcePath = sourceType === 'partial'
            ? join(getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId), filename)
            : getFinalRecordingPath(RECORDINGS_BASE_PATH, cameraId, finalFilename);

        console.log(`[Segment] Enqueue finalization: camera${cameraId}/${filename}`);
        recordingSegmentFinalizer.finalizeSegment({
            cameraId,
            sourcePath,
            filename,
            sourceType,
        }).finally(() => {
            filesBeingProcessed.delete(fileKey);
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
            // SAFETY #1: Don't cleanup if called too frequently (prevent race condition)
            const now = Date.now();
            if (!this.lastCleanupTime) this.lastCleanupTime = {};

            const lastCleanup = this.lastCleanupTime[cameraId] || 0;
            const timeSinceLastCleanup = now - lastCleanup;

            // Only cleanup once per 60 seconds (prevent race condition with new segments)
            if (timeSinceLastCleanup < 60000) {
                console.log(`[Cleanup] Skipping cleanup for camera ${cameraId} (last cleanup ${Math.round(timeSinceLastCleanup / 1000)}s ago)`);
                return;
            }

            this.lastCleanupTime[cameraId] = now;

            // Get camera recording duration (retention period)
            const camera = queryOne('SELECT recording_duration_hours, name FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) {
                console.log(`[Cleanup] Camera ${cameraId} not found, skipping cleanup`);
                return;
            }

            return await cleanupService.cleanupCamera({
                cameraId,
                camera,
                nowMs: now,
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
        }, 5000); // Check every 5 seconds
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

            const timeout = camera.is_tunnel === 1 ? 10000 : 30000;
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

    async shutdown() {
        this.isShuttingDown = true;
        this.scheduler?.stop();
        const results = await recordingProcessManager.shutdownAll('server_shutdown');
        const drainResult = await recordingSegmentFinalizer.drain(30000);
        if (!drainResult.drained) {
            console.warn(`[Shutdown] Recording finalizer drain timed out with ${drainResult.pending} pending file(s)`);
        }
        return results;
    }

    attachScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    initializeBackgroundWork() {
        if (!this.scheduler) {
            this.startSegmentScanner();
            this.startBackgroundCleanup();
            this.startScheduledCleanup();
            return;
        }

        this.scheduler.start({
            startSegmentScanner: (scheduleTimeout) => this.startSegmentScanner(scheduleTimeout),
            startBackgroundCleanup: (scheduleTimeout) => this.startBackgroundCleanup(scheduleTimeout),
            startScheduledCleanup: (scheduleTimeout) => this.startScheduledCleanup(scheduleTimeout),
        });
    }

    /**
     * Periodic segment scanner - fallback if FFmpeg output detection fails
     * Scans recording folders every 60 seconds for new MP4 files
     * FIX: Now scans ALL camera directories, not just active recordings
     */
    startSegmentScanner(scheduleTimeout = setTimeout) {
        // Initial cleanup of temp files
        this.cleanupTempFiles();

        const scanCycle = async () => {
            try {
                // FIX: Scan ALL camera directories on disk, not just active recordings
                // This ensures stopped cameras with orphaned files are also processed
                try { await fsPromises.access(RECORDINGS_BASE_PATH); } catch { scheduleTimeout(scanCycle, 60000); return; }

                const cameraDirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);

                for (const dirName of cameraDirs) {
                    const cameraDir = join(RECORDINGS_BASE_PATH, dirName);

                    // Skip non-directories
                    try {
                        const st = await fsPromises.stat(cameraDir);
                        if (!st.isDirectory()) continue;
                    } catch { continue; }

                    // Extract camera ID
                    const cameraIdMatch = dirName.match(/camera(\d+)/);
                    if (!cameraIdMatch) continue;
                    const cameraId = parseInt(cameraIdMatch[1]);

                    // Verify camera exists and has recording enabled
                    const camera = queryOne('SELECT id, enable_recording FROM cameras WHERE id = ?', [cameraId]);
                    if (!camera || !camera.enable_recording) continue;

                    try {
                        const allFiles = await fsPromises.readdir(cameraDir);
                        const finalFiles = allFiles.filter(isFinalSegmentFilename);
                        let partialFiles = [];
                        const pendingDir = getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId);
                        try {
                            partialFiles = (await fsPromises.readdir(pendingDir)).filter(isPartialSegmentFilename);
                        } catch {
                            partialFiles = [];
                        }

                        const existingFilesSet = new Set(
                            query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                                .map(row => row.filename)
                        );

                        for (const filename of partialFiles) {
                            const finalFilename = toFinalSegmentFilename(filename);
                            if (!finalFilename || existingFilesSet.has(finalFilename)) continue;
                            const filePath = join(pendingDir, filename);
                            const stats = await fsPromises.stat(filePath);
                            const fileAge = Date.now() - stats.mtimeMs;
                            const fileKey = `${cameraId}:${finalFilename}`;
                            if (filesBeingProcessed.has(fileKey)) continue;
                            if (fileAge > 30000) {
                                console.log(`[Scanner] Found pending segment: ${filename} (age: ${Math.round(fileAge / 1000)}s)`);
                                this.onSegmentCreated(cameraId, filename);
                            }
                        }

                        for (const filename of finalFiles) {
                            if (isFileFailed(cameraId, filename)) {
                                const failedPath = join(cameraDir, filename);
                                try {
                                    await fsPromises.access(failedPath);
                                    const quarantineResult = await quarantineFailedRemuxFileIfExpired(cameraId, filename, failedPath, 'scanner_remux_failed_3x');
                                    if (!quarantineResult.retained) {
                                        console.log(`[Scanner] Quarantined expired failed-remux file: ${filename}`);
                                    }
                                } catch {
                                    removeFailedFile(cameraId, filename);
                                }
                                continue;
                            }

                            if (!existingFilesSet.has(filename)) {
                                const filePath = join(cameraDir, filename);
                                const stats = await fsPromises.stat(filePath);
                                const fileKey = `${cameraId}:${filename}`;
                                if (filesBeingProcessed.has(fileKey)) continue;
                                const fileAge = Date.now() - stats.mtimeMs;
                                if (fileAge > 30000) {
                                    console.log(`[Scanner] Found unregistered final segment: ${filename} (age: ${Math.round(fileAge / 1000)}s)`);
                                    this.onSegmentCreated(cameraId, filename);
                                }
                            }
                        }                    } catch (error) {
                        console.error(`[Scanner] Error scanning camera ${cameraId}:`, error);
                    }
                }
            } catch (error) {
                console.error(`[Scanner] Error in segment scanner:`, error);
            }

            // Recursive timeout to prevent intervals from overlapping each other
            scheduleTimeout(scanCycle, 60000);
        };

        // Delay first scan by 60s
        scheduleTimeout(scanCycle, 60000);
    }

    /**
     * Cleanup temp files from failed re-mux attempts
     * CRITICAL FIX: Only delete .temp.mp4 and .remux.mp4 files
     * NEVER delete actual recording files (.mp4) - let segment scanner handle registration
     */
    async cleanupTempFiles() {
        try {
            console.log('[Cleanup] Scanning for temp files...');

            try { await fsPromises.access(RECORDINGS_BASE_PATH); } catch { return; }

            const cameraDirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
            let cleanedCount = 0;
            let dbCleanedCount = 0;

            for (const cameraDir of cameraDirs) {
                const fullPath = join(RECORDINGS_BASE_PATH, cameraDir);
                try {
                    const st = await fsPromises.stat(fullPath);
                    if (!st.isDirectory()) continue;
                } catch { continue; }

                // Extract camera ID from directory name (e.g., "camera1" -> 1)
                const cameraIdMatch = cameraDir.match(/camera(\d+)/);
                if (!cameraIdMatch) continue;
                const cameraId = parseInt(cameraIdMatch[1]);

                const files = await fsPromises.readdir(fullPath);
                for (const file of files) {
                    // CRITICAL FIX: ONLY delete .temp.mp4 or .remux.mp4 files
                    // NEVER delete actual recording files (YYYYMMDD_HHMMSS.mp4)
                    if (file.includes('.temp.mp4') || file.includes('.remux.mp4')) {
                        const filePath = join(fullPath, file);

                        try {
                            // Additional safety: check file age (at least 5 minutes old)
                            const stats = await fsPromises.stat(filePath);
                            const fileAge = Date.now() - stats.mtimeMs;

                            if (fileAge > 5 * 60 * 1000) {
                                await fsPromises.unlink(filePath);
                                cleanedCount++;
                                console.log(`[Cleanup] Deleted temp file: ${cameraDir}/${file} (age: ${Math.round(fileAge / 60000)}min)`);
                            }
                        } catch (statErr) {
                            // File may have been deleted by another process
                        }
                    }
                }

                // CRITICAL FIX: Only cleanup database entries for TEMP files or very old missing files
                const dbSegments = query(
                    'SELECT * FROM recording_segments WHERE camera_id = ?',
                    [cameraId]
                );

                for (const segment of dbSegments) {
                    // SAFETY: Only cleanup entries older than 30 minutes (was 5 minutes)
                    const segmentAge = Date.now() - new Date(segment.start_time || 0).getTime();
                    const isVeryOld = segmentAge > 30 * 60 * 1000; // 30 minutes

                    let fileExists = true;
                    try { await fsPromises.access(segment.file_path); } catch { fileExists = false; }

                    // Only delete DB entries for:
                    // 1. Temp files (.temp.mp4 or .remux.mp4 in filename)
                    // 2. Very old entries (30+ minutes) where file doesn't exist
                    if (segment.filename.includes('.temp.mp4') ||
                        segment.filename.includes('.remux.mp4') ||
                        (isVeryOld && !fileExists)) {

                        execute('DELETE FROM recording_segments WHERE id = ?', [segment.id]);
                        dbCleanedCount++;
                        console.log(`[Cleanup] Deleted DB entry: ${segment.filename} (age: ${Math.round(segmentAge / 60000)}min, file exists: ${fileExists})`);
                    }
                }
            }

            if (cleanedCount > 0 || dbCleanedCount > 0) {
                console.log(`[Cleanup] ✓ Cleaned up ${cleanedCount} temp files and ${dbCleanedCount} DB entries`);
            } else {
                console.log('[Cleanup] No temp files or orphaned DB entries found');
            }
        } catch (error) {
            console.error('[Cleanup] Error cleaning temp files:', error);
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

    /**
     * Background cleanup for corrupt/unregistered files
     * Runs slowly (1 file per 10 seconds) to avoid CPU spike
     * FIX: Now respects retention period - deletes old files instead of re-registering
     * Only attempts registration for files within retention period
     */
    startBackgroundCleanup(scheduleTimeout = setTimeout) {
        console.log('[Cleanup] Starting background cleanup service (1 file per 10s)');

        let cleanupQueue = [];
        let isBuildingQueue = false;

        // Build cleanup queue every 5 minutes
        const buildQueue = async () => {
            if (isBuildingQueue) return;
            isBuildingQueue = true;
            try {
                try { await fsPromises.access(RECORDINGS_BASE_PATH); } catch { isBuildingQueue = false; return; }

                const cameraDirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
                const unregistered = [];

                for (const dirName of cameraDirs) {
                    const fullPath = join(RECORDINGS_BASE_PATH, dirName);
                    try {
                        const st = await fsPromises.stat(fullPath);
                        if (!st.isDirectory()) continue;
                    } catch { continue; }

                    const cameraIdMatch = dirName.match(/camera(\d+)/);
                    if (!cameraIdMatch) continue;
                    const cameraId = parseInt(cameraIdMatch[1]);

                    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                    const retentionMs = ((camera && camera.recording_duration_hours) ? camera.recording_duration_hours : 5) * 60 * 60 * 1000;
                    const retentionWithGrace = retentionMs + Math.max(RECORDING_RETENTION_GRACE_MS, retentionMs * 0.1);

                    const allFiles = await fsPromises.readdir(fullPath);
                    const files = allFiles.filter(f => /^\d{8}_\d{6}\.mp4$/.test(f));

                    const existingFilesSet = new Set(
                        query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                            .map(row => row.filename)
                    );

                    for (const filename of files) {
                        if (!existingFilesSet.has(filename)) {
                            const filePath = join(fullPath, filename);
                            try {
                                const stats = await fsPromises.stat(filePath);
                                const fileAge = Date.now() - stats.mtimeMs;

                                const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
                                let ageToUse = fileAge;
                                if (match) {
                                    const [, year, month, day, hour, minute, second] = match;
                                    const fileTimestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).getTime();
                                    ageToUse = Math.max(fileAge, Date.now() - fileTimestamp);
                                }

                                if (ageToUse > 30 * 60 * 1000) {
                                    unregistered.push({
                                        cameraId, filename, path: filePath, age: ageToUse, fileSize: stats.size,
                                        retentionMs, beyondRetention: ageToUse > retentionWithGrace
                                    });
                                }
                            } catch { }
                        }
                    }
                }

                if (unregistered.length > 0) {
                    console.log(`[BGCleanup] Found ${unregistered.length} old unregistered files (30+ min), adding to cleanup queue`);
                    cleanupQueue = unregistered.sort((a, b) => {
                        if (a.beyondRetention && !b.beyondRetention) return -1;
                        if (!a.beyondRetention && b.beyondRetention) return 1;
                        return b.age - a.age;
                    });
                }
            } catch (error) {
                console.error('[BGCleanup] Error building queue:', error);
            } finally {
                isBuildingQueue = false;
            }
        };

        const processQueueCycle = async () => {
            if (cleanupQueue.length > 0) {
                try {
                    const file = cleanupQueue.shift();

                    let fileExists = true;
                    try { await fsPromises.access(file.path); } catch { fileExists = false; }

                    if (fileExists) {
                        const fileKey = `${file.cameraId}:${file.filename}`;
                        if (filesBeingProcessed.has(fileKey)) {
                            console.log(`[BGCleanup] File being processed, skipping: ${file.filename}`);
                        } else if (file.beyondRetention) {
                            try {
                                const deleteResult = await deleteRecordingFileSafely({
                                    cameraId: file.cameraId,
                                    filename: file.filename,
                                    filePath: file.path,
                                    reason: 'background_orphan_retention_expired',
                                });
                                if (!deleteResult.success) {
                                    throw new Error(deleteResult.reason || 'delete_failed');
                                }
                                const fileSizeMB = (deleteResult.size / (1024 * 1024)).toFixed(2);
                                console.log(`[BGCleanup] ✓ Deleted old unregistered file beyond retention: camera${file.cameraId}/${file.filename} (age: ${Math.round(file.age / 3600000)}h, size: ${fileSizeMB}MB)`);
                                removeFailedFile(file.cameraId, file.filename);
                            } catch (err) {
                                console.error(`[BGCleanup] Error deleting old file ${file.filename}:`, err.message);
                            }
                        } else {
                            try {
                                await execPromise(`ffprobe -v error "${file.path}"`, { timeout: 3000 });
                                console.log(`[BGCleanup] File valid but unregistered (age: ${Math.round(file.age / 60000)}min), triggering registration: ${file.filename}`);
                                this.onSegmentCreated(file.cameraId, file.filename);
                            } catch (error) {
                                console.log(`[BGCleanup] Keeping corrupt/unplayable file until retention expiry: camera${file.cameraId}/${file.filename} (age: ${Math.round(file.age / 60000)}min)`);
                            }
                        }
                    }
                } catch (error) {
                    console.error('[BGCleanup] Error processing file:', error);
                }
            }
            scheduleTimeout(processQueueCycle, 10000);
        };

        const scheduledBuildQueue = async () => {
            await buildQueue();
            scheduleTimeout(scheduledBuildQueue, 5 * 60 * 1000);
        };

        // Start tasks
        scheduleTimeout(scheduledBuildQueue, 30000);
        scheduleTimeout(processQueueCycle, 10000);
    }

    /**
     * Scheduled cleanup - runs every 5 minutes
     * This is the PRIMARY cleanup mechanism (not per-segment cleanup)
     * FIX: Also includes emergency disk space check
     */
    startScheduledCleanup(scheduleTimeout = setTimeout) {
        console.log('[Cleanup] Starting scheduled cleanup service (every 5 minutes)');

        const runScheduledClean = async () => {
            try {
                const enabledCameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
                const allCameraIds = new Set(enabledCameras.map(c => c.id));

                try {
                    await fsPromises.access(RECORDINGS_BASE_PATH);
                    const dirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
                    for (const d of dirs) {
                        const match = d.match(/camera(\d+)/);
                        if (match) allCameraIds.add(parseInt(match[1]));
                    }
                } catch (e) { }

                console.log(`[Cleanup] Running scheduled cleanup for ${allCameraIds.size} cameras...`);

                for (const cameraId of allCameraIds) {
                    await this.cleanupOldSegments(cameraId);
                }

                await this.emergencyDiskSpaceCheck();
                console.log('[Cleanup] Scheduled cleanup complete');
            } catch (error) {
                console.error('[Cleanup] Scheduled cleanup error:', error);
            }
            scheduleTimeout(runScheduledClean, SCHEDULED_CLEANUP_INTERVAL_MS);
        };

        scheduleTimeout(runScheduledClean, SCHEDULED_CLEANUP_INITIAL_DELAY_MS);
    }

    /**
     * Emergency disk space check
     * If available space is below 1GB, aggressively delete oldest files
     */
    async emergencyDiskSpaceCheck() {
        try {
            let freeBytes = 0;

            try {
                // Windows: use wmic or PowerShell
                const drive = RECORDINGS_BASE_PATH.charAt(0);
                const { stdout } = await execPromise(
                    `powershell -Command "(Get-PSDrive ${drive}).Free"`,
                    { encoding: 'utf8', timeout: 5000 }
                );
                freeBytes = parseInt(stdout.trim()) || 0;
            } catch {
                try {
                    // Linux/Mac fallback: use df
                    const { stdout } = await execPromise(
                        `df -B1 "${RECORDINGS_BASE_PATH}" | tail -1 | awk '{print $4}'`,
                        { encoding: 'utf8', timeout: 5000 }
                    );
                    freeBytes = parseInt(stdout.trim()) || 0;
                } catch {
                    // Can't determine free space, skip emergency check
                    return;
                }
            }

            const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
            console.log(`[DiskCheck] Free disk space: ${freeGB}GB`);

            // Emergency threshold: 1GB
            const EMERGENCY_THRESHOLD = 1 * 1024 * 1024 * 1024; // 1GB

            if (freeBytes > EMERGENCY_THRESHOLD) {
                return; // Enough space
            }

            console.warn(`[DiskCheck] ⚠️ LOW DISK SPACE: ${freeGB}GB free. Starting emergency cleanup...`);

            // Fix OOM Issue: fetch chunks at a time into memory
            let freedBytes = 0;
            let deletedCount = 0;

            const emergencyResult = await cleanupService.emergencyCleanup({
                freeBytes,
                targetFreeBytes: 2 * 1024 * 1024 * 1024,
                batchLimit: 200,
                getCameraRetentionHours: (cameraId) => {
                    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                    return camera?.recording_duration_hours;
                },
            });

            freedBytes += emergencyResult.deletedBytes;
            deletedCount += emergencyResult.deleted;

            // Also scan for filesystem orphans
            let baseDirExists = true;
            try { await fsPromises.access(RECORDINGS_BASE_PATH); } catch { baseDirExists = false; }

            if (baseDirExists && (freeBytes + freedBytes) < 2 * 1024 * 1024 * 1024) {
                const cameraDirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
                for (const dir of cameraDirs) {
                    const fullDirPath = join(RECORDINGS_BASE_PATH, dir);
                    try {
                        const st = await fsPromises.stat(fullDirPath);
                        if (!st.isDirectory()) continue;
                    } catch { continue; }

                    const allFiles = await fsPromises.readdir(fullDirPath);
                    const files = [];

                    for (const f of allFiles) {
                        if (/^\d{8}_\d{6}\.mp4$/.test(f) || f.includes('.remux.mp4') || f.includes('.temp.mp4')) {
                            const fp = join(fullDirPath, f);
                            try {
                                const st = await fsPromises.stat(fp);
                                files.push({ name: f, path: fp, mtime: st.mtimeMs, size: st.size });
                            } catch { }
                        }
                    }

                    files.sort((a, b) => a.mtime - b.mtime);

                    for (const file of files) {
                        if ((freeBytes + freedBytes) > 2 * 1024 * 1024 * 1024) break;
                        try {
                            const cameraIdMatch = dir.match(/camera(\d+)/);
                            const cameraId = cameraIdMatch ? parseInt(cameraIdMatch[1]) : null;
                            const camera = cameraId
                                ? queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId])
                                : null;
                            const nowMs = Date.now();
                            const retentionWindow = computeRetentionWindow({
                                retentionHours: camera?.recording_duration_hours,
                                nowMs,
                            });
                            const deletePolicy = canDeleteRecordingFile({
                                filename: file.name,
                                fileMtimeMs: file.mtime,
                                retentionWindow,
                                nowMs,
                            });

                            if (!deletePolicy.allowed) {
                                continue;
                            }

                            const deleteResult = await deleteRecordingFileSafely({
                                cameraId,
                                filename: file.name,
                                filePath: file.path,
                                reason: 'emergency_filesystem_cleanup',
                            });
                            if (deleteResult.success) {
                                freedBytes += deleteResult.size;
                                deletedCount++;
                            }
                        } catch { }
                    }
                }
            }

            if (deletedCount > 0) {
                console.warn(`[DiskCheck] 🚨 Emergency cleanup: deleted ${deletedCount} files, freed ${(freedBytes / 1024 / 1024).toFixed(2)}MB`);
            }

        } catch (error) {
            console.error('[DiskCheck] Error checking disk space:', error.message);
        }
    }

    /**
     * Auto-start recordings on service init with retry logic
     */
    async autoStartRecordings() {
        try {
            const cameras = query(
                'SELECT id, COALESCE(is_online, 1) as is_online FROM cameras WHERE enable_recording = 1 AND enabled = 1'
            );

            console.log(`[Recording] Found ${cameras.length} cameras with recording enabled`);

            if (cameras.length === 0) {
                console.log('[Recording] No cameras configured for recording');
                return;
            }

            let successCount = 0;
            let failCount = 0;

            for (const camera of cameras) {
                if (camera.is_online !== 1) {
                    this.suspendRecordingForOffline(camera.id);
                    console.log(`[Recording] Skipping camera ${camera.id} auto-start because source is currently offline`);
                    continue;
                }

                let retries = 3;
                let success = false;

                while (retries > 0 && !success) {
                    const attemptNum = 4 - retries;
                    console.log(`[Recording] Starting camera ${camera.id} (attempt ${attemptNum}/3)...`);

                    const result = await this.startRecording(camera.id);

                    if (result.success) {
                        console.log(`[Recording] ✓ Camera ${camera.id} recording started successfully`);
                        successCount++;
                        success = true;
                    } else {
                        console.error(`[Recording] ✗ Camera ${camera.id} failed: ${result.message}`);
                        retries--;

                        if (retries > 0) {
                            console.log(`[Recording] Retrying camera ${camera.id} in 2 seconds...`);
                            await new Promise(resolve => setTimeout(resolve, 2000)); // Reduced from 5s to 2s
                        }
                    }
                }

                if (!success) {
                    console.error(`[Recording] ✗ Camera ${camera.id} failed after 3 attempts - skipping`);
                    failCount++;
                }

                // Stagger starts between cameras (reduced from 2s to 500ms)
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.log(`[Recording] Auto-start complete: ${successCount} succeeded, ${failCount} failed`);

        } catch (error) {
            console.error('[Recording] Error in auto-starting recordings:', error);
        }
    }
}

// Export singleton instance
export const recordingService = new RecordingService();
export { RecordingService };
