// Purpose: Orchestrate recording segment cleanup with bounded batches and per-camera locking.
// Caller: recordingService scheduled cleanup and cleanup tests.
// Deps: fs promises, path join, recording retention policy, segment repository.
// MainFuncs: createRecordingCleanupService, cleanupCamera.
// SideEffects: Deletes recording files through injected safeDelete and removes DB rows through repository.

import { promises as defaultFs } from 'fs';
import { join } from 'path';
import {
    computeRetentionWindow,
    getSegmentAgeMs,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';

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

        const filenames = await fs.readdir(cameraDir);
        const dbFilenames = new Set(repository.listFilenamesByCamera(cameraId));

        for (const filename of filenames) {
            if (!isSafeRecordingFilename(filename) || dbFilenames.has(filename)) {
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

            const ageMs = getSegmentAgeMs({ filename, fileMtimeMs: stats.mtimeMs, nowMs });
            if (ageMs <= retentionWindow.retentionWithGraceMs) {
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

    return { cleanupCamera };
}
