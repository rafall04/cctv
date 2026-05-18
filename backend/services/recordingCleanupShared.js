// Purpose: Shared primitives for recording cleanup sub-modules — result struct, delete-result accumulator,
//          temp-file age policy.
// Caller: recordingExpiredDbSegmentCleanup, recordingFilesystemOrphanCleanup,
//         recordingPendingPartialCleanup, recordingEmergencyCleanup, recordingCleanupService.
// Deps: recordingSegmentFilePolicy (isTempSegmentFilename), recordingIntervalsPolicy (TEMP_FILE_MIN_AGE_MS).
// MainFuncs: createEmptyResult, applyDeleteFailure, canDeleteTempFile.
// SideEffects: None.

import { isTempSegmentFilename } from './recordingSegmentFilePolicy.js';
import { RECORDING_TEMP_FILE_MIN_AGE_MS } from './recordingIntervalsPolicy.js';

export function createEmptyResult() {
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

/**
 * Increments either result.unsafeSkipped or result.failed based on a failed safeDelete reason.
 * Returns true if the caller should continue the loop.
 */
export function applyDeleteFailure(deleteResult, result) {
    if (deleteResult.reason === 'unsafe_path') {
        result.unsafeSkipped++;
    } else {
        result.failed++;
    }
    return true;
}

export function canDeleteTempFile({ filename, fileMtimeMs, nowMs }) {
    return isTempSegmentFilename(filename) && (nowMs - fileMtimeMs) > RECORDING_TEMP_FILE_MIN_AGE_MS;
}
