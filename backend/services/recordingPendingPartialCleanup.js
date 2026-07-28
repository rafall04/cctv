// Purpose: Delete pending .mp4.partial files whose final counterpart has been finalized in DB,
//          or whose retention window plus grace has elapsed.
// Caller: recordingCleanupService per-camera orchestrator.
// Deps: recordingRetentionPolicy, recordingSegmentFilePolicy, recordingCleanupShared, recordingIntervalsPolicy,
//        repository, fs, safeDelete.
// MainFuncs: createPendingPartialCleanup, cleanupPendingPartials.
// SideEffects: Reads pending dir, deletes files via safeDelete.

import { join } from 'path';
import { applyDeleteFailure } from './recordingCleanupShared.js';
import {
    canDeleteRecordingFile,
    describeRecordingRetentionDecision,
} from './recordingRetentionPolicy.js';
import {
    getPendingRecordingDir,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
import { RECORDING_FINALIZED_PARTIAL_MIN_AGE_MS } from './recordingIntervalsPolicy.js';

export function createPendingPartialCleanup({
    repository,
    fs,
    recordingsBasePath,
    safeDelete,
    isFileBeingProcessed,
    logger = console,
} = {}) {
    return async function cleanupPendingPartials({ cameraId, retentionWindow, nowMs, result }) {
        const pendingDir = getPendingRecordingDir(recordingsBasePath, cameraId);
        let filenames;
        try {
            filenames = (await fs.readdir(pendingDir))
                .filter((filename) => isPartialSegmentFilename(filename));
        } catch {
            return;
        }

        if (!filenames.length) {
            return;
        }

        const finalFilenames = filenames
            .map((filename) => toFinalSegmentFilename(filename))
            .filter(Boolean);
        const dbFilenames = new Set(repository.findExistingFilenames({
            cameraId,
            filenames: finalFilenames,
        }));

        const kept = { count: 0, oldestAgeMs: -1, oldestDecision: null };

        for (const filename of filenames) {
            const finalFilename = toFinalSegmentFilename(filename);
            if (!finalFilename) {
                result.unsafeSkipped++;
                continue;
            }

            if (
                isFileBeingProcessed(cameraId, filename)
                || isFileBeingProcessed(cameraId, finalFilename)
            ) {
                result.processingSkipped++;
                continue;
            }

            const filePath = join(pendingDir, filename);
            let stats;
            try {
                stats = await fs.stat(filePath);
            } catch {
                result.failed++;
                continue;
            }

            const fileAgeMs = nowMs - stats.mtimeMs;
            const isFinalizedDuplicate = dbFilenames.has(finalFilename)
                && fileAgeMs > RECORDING_FINALIZED_PARTIAL_MIN_AGE_MS;
            if (isFinalizedDuplicate) {
                const deleteResult = await safeDelete({
                    cameraId,
                    filename,
                    filePath,
                    reason: 'pending_partial_finalized_duplicate',
                });

                if (!deleteResult.success) {
                    applyDeleteFailure(deleteResult, result);
                    continue;
                }

                result.orphanDeleted++;
                result.deletedBytes += deleteResult.size || 0;
                continue;
            }

            const deletePolicy = canDeleteRecordingFile({
                filename,
                fileMtimeMs: stats.mtimeMs,
                retentionWindow,
                nowMs,
            });
            if (!deletePolicy.allowed) {
                /*
                 * Counted, not printed. "Still within retention" is the NORMAL answer for every
                 * partial on every cleanup cycle, so printing it per file produced 10,591 lines a
                 * day whose whole content was "nothing happened" — the single largest source of
                 * log volume in the app. One aggregate line below keeps the fact and drops the
                 * noise; the oldest sample is kept so a stuck file is still visible.
                 */
                kept.count += 1;
                if (deletePolicy.ageMs > kept.oldestAgeMs) {
                    kept.oldestAgeMs = deletePolicy.ageMs;
                    kept.oldestDecision = describeRecordingRetentionDecision({ filename, decision: deletePolicy });
                }
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename,
                filePath,
                reason: 'pending_partial_retention_expired',
            });

            if (!deleteResult.success) {
                applyDeleteFailure(deleteResult, result);
                continue;
            }

            result.orphanDeleted++;
            result.deletedBytes += deleteResult.size || 0;
        }

        if (kept.count > 0) {
            logger.log?.(`[Cleanup] camera${cameraId}: kept ${kept.count} pending partial(s), oldest ${kept.oldestDecision}`);
        }
    };
}
