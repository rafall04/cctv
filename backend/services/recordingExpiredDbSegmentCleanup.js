// Purpose: Delete recording_segments rows + files whose start_time is older than the retention window.
// Caller: recordingCleanupService per-camera orchestrator.
// Deps: recordingIntervalsPolicy (batch size), safeDelete, repository, fs.access, isFileBeingProcessed.
// MainFuncs: createExpiredDbSegmentCleanup, cleanupExpiredDbSegments.
// SideEffects: Deletes files through safeDelete; deletes recording_segments rows through repository.

import { applyDeleteFailure } from './recordingCleanupShared.js';
import { RECORDING_CLEANUP_BATCH_SIZE } from './recordingIntervalsPolicy.js';

export function createExpiredDbSegmentCleanup({
    repository,
    fs,
    safeDelete,
    isFileBeingProcessed,
    batchSize = RECORDING_CLEANUP_BATCH_SIZE,
} = {}) {
    return async function cleanupExpiredDbSegments({ cameraId, retentionWindow, result }) {
        const segments = repository.findExpiredSegments({
            cameraId,
            cutoffIso: retentionWindow.cutoffIso,
            limit: batchSize,
        });

        for (const segment of segments) {
            if (isFileBeingProcessed(cameraId, segment.filename)) {
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
                applyDeleteFailure(deleteResult, result);
                continue;
            }

            repository.deleteSegmentById(segment.id);
            result.deleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    };
}
