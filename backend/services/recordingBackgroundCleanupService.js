// Purpose: Own slow background reconciliation of unregistered recording files.
// Caller: recordingService compatibility facade through recording scheduler.
// Deps: filesystem, DB read helpers, recording retention policy, ffprobe callback.
// MainFuncs: createRecordingBackgroundCleanupService, start.
// SideEffects: Schedules queue build/process loops and may enqueue segment recovery.

import { join } from 'path';
import recordingRecoveryService from './recordingRecoveryService.js';
import { computeRetentionWindow, getSegmentAgeMs } from './recordingRetentionPolicy.js';
import {
    RECORDING_BG_CLEANUP_BUILD_INITIAL_DELAY_MS as BUILD_QUEUE_INITIAL_DELAY_MS,
    RECORDING_BG_CLEANUP_BUILD_INTERVAL_MS as BUILD_QUEUE_INTERVAL_MS,
    RECORDING_BG_CLEANUP_PROCESS_INTERVAL_MS as PROCESS_QUEUE_INTERVAL_MS,
    RECORDING_BG_UNREGISTERED_MIN_AGE_MS as MIN_UNREGISTERED_FILE_AGE_MS,
} from './recordingIntervalsPolicy.js';

export function createRecordingBackgroundCleanupService({
    recordingsBasePath,
    fs,
    query,
    queryOne,
    ffprobe,
    recoveryService = recordingRecoveryService,
    onSegmentCreated,
    logger = console,
    now = Date.now,
} = {}) {
    let cleanupQueue = [];
    let isBuildingQueue = false;

    async function buildQueue() {
        if (isBuildingQueue) return;
        isBuildingQueue = true;
        try {
            try {
                await fs.access(recordingsBasePath);
            } catch {
                return;
            }

            const cameraDirs = await fs.readdir(recordingsBasePath);
            const unregistered = [];
            for (const dirName of cameraDirs) {
                const cameraIdMatch = String(dirName).match(/^camera(\d+)$/);
                if (!cameraIdMatch) continue;

                const cameraId = Number.parseInt(cameraIdMatch[1], 10);
                const fullPath = join(recordingsBasePath, dirName);
                let dirStats;
                try {
                    dirStats = await fs.stat(fullPath);
                } catch {
                    continue;
                }
                if (!dirStats.isDirectory()) continue;

                const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                const retentionWindow = computeRetentionWindow({
                    retentionHours: camera?.recording_duration_hours,
                    nowMs: now(),
                });
                const existingFilesSet = new Set(
                    query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                        .map((row) => row.filename)
                );

                const filenames = (await fs.readdir(fullPath)).filter((filename) => /^\d{8}_\d{6}\.mp4$/.test(filename));
                for (const filename of filenames) {
                    if (existingFilesSet.has(filename)) continue;
                    const filePath = join(fullPath, filename);
                    try {
                        const stats = await fs.stat(filePath);
                        const ageMs = getSegmentAgeMs({
                            filename,
                            fileMtimeMs: stats.mtimeMs,
                            nowMs: now(),
                        });
                        if (ageMs > MIN_UNREGISTERED_FILE_AGE_MS) {
                            unregistered.push({
                                cameraId,
                                filename,
                                path: filePath,
                                age: ageMs,
                                fileSize: stats.size,
                                beyondRetention: ageMs > retentionWindow.retentionWithGraceMs,
                            });
                        }
                    } catch {
                        logger.error?.(`[BGCleanup] Failed reading unregistered file: camera${cameraId}/${filename}`);
                    }
                }
            }

            cleanupQueue = unregistered.sort((a, b) => {
                if (a.beyondRetention && !b.beyondRetention) return -1;
                if (!a.beyondRetention && b.beyondRetention) return 1;
                return b.age - a.age;
            });
            if (cleanupQueue.length > 0) {
                logger.log?.(`[BGCleanup] Found ${cleanupQueue.length} old unregistered files (30+ min), adding to cleanup queue`);
            }
        } catch (error) {
            logger.error?.('[BGCleanup] Error building queue:', error);
        } finally {
            isBuildingQueue = false;
        }
    }

    async function processOneQueueItem() {
        if (!cleanupQueue.length) return;
        const file = cleanupQueue.shift();

        try {
            await fs.access(file.path);
        } catch {
            return;
        }

        if (recoveryService.isFileOwned(file.cameraId, file.filename)) {
            logger.log?.(`[BGCleanup] File being processed, skipping: ${file.filename}`);
            return;
        }

        if (file.beyondRetention) {
            logger.log?.(`[BGCleanup] Requeueing old unregistered final file for recovery before deletion: camera${file.cameraId}/${file.filename}`);
            onSegmentCreated(file.cameraId, file.filename);
            return;
        }

        try {
            await ffprobe(file.path);
            logger.log?.(`[BGCleanup] File valid but unregistered (age: ${Math.round(file.age / 60000)}min), triggering registration: ${file.filename}`);
            onSegmentCreated(file.cameraId, file.filename);
        } catch {
            logger.log?.(`[BGCleanup] Keeping corrupt/unplayable file until retention expiry: camera${file.cameraId}/${file.filename} (age: ${Math.round(file.age / 60000)}min)`);
        }
    }

    async function drain(timeoutMs = 30000) {
        const deadline = Date.now() + timeoutMs;
        while (isBuildingQueue && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        return { drained: !isBuildingQueue, pending: isBuildingQueue ? 1 : 0 };
    }

    return {
        buildQueue,
        processOneQueueItem,
        drain,
        buildIntervalMs: BUILD_QUEUE_INTERVAL_MS,
        buildInitialDelayMs: BUILD_QUEUE_INITIAL_DELAY_MS,
        processIntervalMs: PROCESS_QUEUE_INTERVAL_MS,
    };
}
