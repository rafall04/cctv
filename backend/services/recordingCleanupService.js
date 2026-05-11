// Purpose: Orchestrate recording segment cleanup with bounded batches and per-camera locking.
// Caller: recordingService scheduled cleanup and cleanup tests.
// Deps: fs promises, path join, recording retention policy, segment repository.
// MainFuncs: createRecordingCleanupService, cleanupCamera.
// SideEffects: Deletes recording files through injected safeDelete and removes DB rows through repository.

import { promises as defaultFs } from 'fs';
import { join } from 'path';
import {
    canDeleteRecordingFile,
    computeRetentionWindow,
    describeRecordingRetentionDecision,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';
import { isFinalSegmentFilename } from './recordingSegmentFilePolicy.js';

const NORMAL_DELETE_BATCH_SIZE = 6;

function createEmptyResult() {
    return {
        deleted: 0,
        deletedBytes: 0,
        missingRowsDeleted: 0,
        unsafeSkipped: 0,
        processingSkipped: 0,
        failed: 0,
        orphanDeleted: 0,
        skippedReason: null,
    };
}

export function createRecordingCleanupService({
    repository,
    fs = defaultFs,
    recordingsBasePath,
    safeDelete,
    isFileBeingProcessed,
    onRecoverOrphan,
    logger = console,
} = {}) {
    const inFlightCameraIds = new Set();

    async function cleanupExpiredDbSegments({ cameraId, retentionWindow, result }) {
        const segments = repository.findExpiredSegments({
            cameraId,
            cutoffIso: retentionWindow.cutoffIso,
            limit: NORMAL_DELETE_BATCH_SIZE,
        });

        for (const segment of segments) {
            if (isFileBeingProcessed?.(cameraId, segment.filename)) {
                result.processingSkipped++;
                continue;
            }

            let fileExists = true;
            try {
                await fs.access(segment.file_path);
            } catch {
                fileExists = false;
            }

            if (!fileExists) {
                repository.deleteSegmentById(segment.id);
                result.missingRowsDeleted++;
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename: segment.filename,
                filePath: segment.file_path,
                reason: 'retention_expired',
            });

            if (!deleteResult.success) {
                if (deleteResult.reason === 'unsafe_path') {
                    result.unsafeSkipped++;
                } else {
                    result.failed++;
                }
                continue;
            }

            repository.deleteSegmentById(segment.id);
            result.deleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    }

    async function cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result }) {
        const cameraDir = join(recordingsBasePath, `camera${cameraId}`);
        try {
            await fs.access(cameraDir);
        } catch {
            return;
        }

        const filenames = (await fs.readdir(cameraDir))
            .filter((filename) => isSafeRecordingFilename(filename));
        const dbFilenames = new Set(repository.findExistingFilenames({
            cameraId,
            filenames,
        }));

        for (const filename of filenames) {
            if (dbFilenames.has(filename)) {
                continue;
            }
            if (isFileBeingProcessed?.(cameraId, filename)) {
                result.processingSkipped++;
                continue;
            }

            const filePath = join(cameraDir, filename);
            let stats;
            try {
                stats = await fs.stat(filePath);
            } catch {
                result.failed++;
                continue;
            }

            const deletePolicy = canDeleteRecordingFile({
                filename,
                fileMtimeMs: stats.mtimeMs,
                retentionWindow,
                nowMs,
            });
            if (!deletePolicy.allowed) {
                logger.log?.(`[Cleanup] Keeping orphan recording: camera${cameraId}/${describeRecordingRetentionDecision({
                    filename,
                    decision: deletePolicy,
                })}`);
                continue;
            }

            if (isFinalSegmentFilename(filename) && onRecoverOrphan) {
                await onRecoverOrphan({
                    cameraId,
                    filename,
                    filePath,
                    sourceType: 'final_orphan',
                });
                logger.log?.(`[Cleanup] Requeued final orphan for recovery before delete: camera${cameraId}/${filename}`);
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename,
                filePath,
                reason: 'filesystem_orphan_retention_expired',
            });

            if (!deleteResult.success) {
                if (deleteResult.reason === 'unsafe_path') {
                    result.unsafeSkipped++;
                } else {
                    result.failed++;
                }
                continue;
            }

            result.orphanDeleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    }

    async function cleanupCamera({ cameraId, camera, nowMs = Date.now() }) {
        if (inFlightCameraIds.has(cameraId)) {
            return { ...createEmptyResult(), skippedReason: 'cleanup_in_flight' };
        }

        inFlightCameraIds.add(cameraId);
        const result = createEmptyResult();

        try {
            const retentionWindow = computeRetentionWindow({
                retentionHours: camera?.recording_duration_hours,
                nowMs,
            });

            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });

            logger.log?.(`[Cleanup] Camera ${cameraId} summary: ${JSON.stringify(result)}`);
            return result;
        } finally {
            inFlightCameraIds.delete(cameraId);
        }
    }

    async function emergencyCleanup({
        freeBytes,
        targetFreeBytes,
        batchLimit = 200,
        nowMs = Date.now(),
        getCameraRetentionHours = () => null,
    }) {
        const result = createEmptyResult();
        let cursor = null;
        let keepScanning = true;

        while (keepScanning && (freeBytes + result.deletedBytes) <= targetFreeBytes) {
            const segments = repository.findOldestSegmentsForEmergency({
                afterStartTime: cursor?.start_time || null,
                afterId: cursor?.id || 0,
                limit: batchLimit,
            });

            if (!segments.length) {
                break;
            }

            for (const segment of segments) {
                cursor = { start_time: segment.start_time, id: segment.id };

                if ((freeBytes + result.deletedBytes) > targetFreeBytes) {
                    keepScanning = false;
                    break;
                }

                if (isFileBeingProcessed?.(segment.camera_id, segment.filename)) {
                    result.processingSkipped++;
                    continue;
                }

                let fileMtimeMs = null;
                try {
                    const stats = await fs.stat(segment.file_path);
                    fileMtimeMs = stats.mtimeMs;
                } catch {
                    fileMtimeMs = null;
                }

                const retentionWindow = computeRetentionWindow({
                    retentionHours: getCameraRetentionHours(segment.camera_id),
                    nowMs,
                });
                const deletePolicy = canDeleteRecordingFile({
                    filename: segment.filename,
                    startTime: segment.start_time,
                    fileMtimeMs,
                    retentionWindow,
                    nowMs,
                });
                if (!deletePolicy.allowed) {
                    result.processingSkipped++;
                    logger.log?.(`[Cleanup] Keeping emergency candidate: camera${segment.camera_id}/${describeRecordingRetentionDecision({
                        filename: segment.filename,
                        decision: deletePolicy,
                    })}`);
                    continue;
                }

                const deleteResult = await safeDelete({
                    cameraId: segment.camera_id,
                    filename: segment.filename,
                    filePath: segment.file_path,
                    reason: 'emergency_disk_cleanup',
                });

                if (!deleteResult.success) {
                    if (deleteResult.reason === 'unsafe_path') {
                        result.unsafeSkipped++;
                    } else {
                        result.failed++;
                    }
                    continue;
                }

                repository.deleteSegmentById(segment.id);
                result.deleted++;
                result.deletedBytes += deleteResult.size || 0;
            }
        }

        return result;
    }

    return { cleanupCamera, emergencyCleanup };
}
