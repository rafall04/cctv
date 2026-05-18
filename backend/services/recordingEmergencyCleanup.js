// Purpose: Delete oldest DB-tracked recording segments globally to free disk space under emergency target.
//          May bypass retention only for safe filenames when allowed.
// Caller: recordingEmergencyDiskService → recordingCleanupService.emergencyCleanup.
// Deps: recordingRetentionPolicy, recordingCleanupShared, recordingIntervalsPolicy, repository, fs.stat,
//        safeDelete, isFileBeingProcessed.
// MainFuncs: createEmergencyCleanup, emergencyCleanup.
// SideEffects: Deletes recording_segments rows + files through safeDelete.

import { applyDeleteFailure } from './recordingCleanupShared.js';
import {
    canDeleteRecordingFile,
    computeRetentionWindow,
    describeRecordingRetentionDecision,
} from './recordingRetentionPolicy.js';
import { RECORDING_EMERGENCY_DISK_BATCH_LIMIT } from './recordingIntervalsPolicy.js';

export function createEmergencyCleanup({
    repository,
    fs,
    safeDelete,
    isFileBeingProcessed,
    logger = console,
} = {}) {
    return async function emergencyCleanup({
        freeBytes,
        targetFreeBytes,
        batchLimit = RECORDING_EMERGENCY_DISK_BATCH_LIMIT,
        nowMs = Date.now(),
        getCameraRetentionHours = () => null,
        allowRetentionBypass = false,
        result,
    }) {
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

                if (isFileBeingProcessed(segment.camera_id, segment.filename)) {
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
                let deleteReason = 'emergency_disk_cleanup';
                if (!deletePolicy.allowed && (!allowRetentionBypass || deletePolicy.reason === 'unsafe_filename')) {
                    result.processingSkipped++;
                    logger.log?.(`[Cleanup] Keeping emergency candidate: camera${segment.camera_id}/${describeRecordingRetentionDecision({
                        filename: segment.filename,
                        decision: deletePolicy,
                    })}`);
                    continue;
                }
                if (!deletePolicy.allowed && allowRetentionBypass) {
                    deleteReason = 'emergency_disk_cleanup_retention_bypass';
                    logger.warn?.(`[Cleanup] Emergency retention bypass: camera${segment.camera_id}/${describeRecordingRetentionDecision({
                        filename: segment.filename,
                        decision: deletePolicy,
                    })}`);
                }

                const deleteResult = await safeDelete({
                    cameraId: segment.camera_id,
                    filename: segment.filename,
                    filePath: segment.file_path,
                    reason: deleteReason,
                });

                if (!deleteResult.success) {
                    applyDeleteFailure(deleteResult, result);
                    continue;
                }

                repository.deleteSegmentById(segment.id);
                result.deleted++;
                result.deletedBytes += deleteResult.size || 0;
            }
        }

        return result;
    };
}
