// Purpose: Delete recording files on disk that are not tracked in recording_segments and pass retention policy.
//          Final orphans get one recovery pass before deletion; expired temp files are deleted directly.
// Caller: recordingCleanupService per-camera orchestrator.
// Deps: recordingRetentionPolicy, recordingSegmentFilePolicy, recordingCleanupShared, repository, fs, safeDelete,
//        onRecoverOrphan.
// MainFuncs: createFilesystemOrphanCleanup, cleanupFilesystemOrphans.
// SideEffects: Reads camera directory, deletes files via safeDelete, enqueues recovery via onRecoverOrphan.

import { join } from 'path';
import { applyDeleteFailure, canDeleteTempFile } from './recordingCleanupShared.js';
import {
    canDeleteRecordingFile,
    describeRecordingRetentionDecision,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';
import {
    isFinalSegmentFilename,
    isTempSegmentFilename,
} from './recordingSegmentFilePolicy.js';

export function createFilesystemOrphanCleanup({
    repository,
    fs,
    recordingsBasePath,
    safeDelete,
    isFileBeingProcessed,
    onRecoverOrphan,
    logger = console,
} = {}) {
    return async function cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result }) {
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
            if (isFileBeingProcessed(cameraId, filename)) {
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

            if (canDeleteTempFile({ filename, fileMtimeMs: stats.mtimeMs, nowMs })) {
                const deleteResult = await safeDelete({
                    cameraId,
                    filename,
                    filePath,
                    reason: 'temp_file_expired',
                });

                if (!deleteResult.success) {
                    applyDeleteFailure(deleteResult, result);
                    continue;
                }

                result.orphanDeleted++;
                result.deletedBytes += deleteResult.size || 0;
                continue;
            }

            if (isTempSegmentFilename(filename)) {
                logger.log?.(`[Cleanup] Keeping recent temp recording: camera${cameraId}/${filename}`);
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
                applyDeleteFailure(deleteResult, result);
                continue;
            }

            result.orphanDeleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    };
}
