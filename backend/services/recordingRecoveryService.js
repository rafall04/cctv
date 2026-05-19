// Purpose: Public recording recovery facade. Composes recordingRecoveryRunner (execution) with
//          recordingRecoveryQueue (bounded concurrency) and exposes the recording-domain API
//          (enqueueRecovery, isFileOwned, drain, shouldRetryNow).
// Caller: recordingService (segment-close + scanner + cleanup orphan + bg cleanup).
// Deps: recordingRecoveryQueue, recordingRecoveryRunner, recordingSegmentFinalizer,
//        recordingRecoveryDiagnosticsRepository, recordingFileOperationService,
//        recordingPartialRecoveryPolicy, recordingSegmentFilePolicy, recordingIntervalsPolicy.
// MainFuncs: createRecordingRecoveryService → enqueueRecovery, isFileOwned, drain, shouldRetryNow.
// SideEffects: Through runner: spawns finalizer (ffmpeg/ffprobe), writes diagnostics, quarantines on terminal failure.

import recordingFileOperationService from './recordingFileOperationService.js';
import { decideRecoveryRetry } from './recordingPartialRecoveryPolicy.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import { toFinalSegmentFilename } from './recordingSegmentFilePolicy.js';
import {
    RECORDING_RECOVERY_MAX_ATTEMPTS,
    RECORDING_RECOVERY_MAX_CONCURRENT,
} from './recordingIntervalsPolicy.js';
import { createRecordingRecoveryQueue } from './recordingRecoveryQueue.js';
import { createRecordingRecoveryRunner } from './recordingRecoveryRunner.js';

function keyFromInput(input) {
    const finalFilename = toFinalSegmentFilename(input.filename) || input.filename;
    return `${input.cameraId}:${finalFilename}`;
}

function keyFromCameraFile(cameraId, filename) {
    const finalFilename = toFinalSegmentFilename(filename) || filename;
    return `${cameraId}:${finalFilename}`;
}

export function createRecordingRecoveryService({
    finalizer = recordingSegmentFinalizer,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    fileOperations = recordingFileOperationService,
    maxConcurrent = RECORDING_RECOVERY_MAX_CONCURRENT,
    maxAttempts = RECORDING_RECOVERY_MAX_ATTEMPTS,
    logger = console,
} = {}) {
    const runner = createRecordingRecoveryRunner({
        finalizer,
        diagnosticsRepository,
        fileOperations,
        maxAttempts,
        logger,
    });
    const queue = createRecordingRecoveryQueue({
        runJob: (input) => runner.runRecovery(input),
        keyFn: keyFromInput,
        maxConcurrent,
    });

    function shouldRetryNow({ cameraId, filename, sourceType, nowMs = Date.now() }) {
        const finalFilename = toFinalSegmentFilename(filename) || filename;
        const diagnostic = diagnosticsRepository.getActiveDiagnostic?.({
            cameraId,
            filename: finalFilename,
        });

        if (!diagnostic || diagnostic.filename !== finalFilename || !diagnostic.reason) {
            return { allowed: true, reason: 'no_active_diagnostic' };
        }

        const lastAttemptAtMs = Date.parse(
            diagnostic.last_seen_at
            || diagnostic.updated_at
            || diagnostic.detected_at
            || ''
        );
        const decision = decideRecoveryRetry({
            sourceType,
            reason: diagnostic.reason,
            attemptCount: diagnostic.attempt_count,
            lastAttemptAtMs: Number.isFinite(lastAttemptAtMs) ? lastAttemptAtMs : null,
            nowMs,
            maxAttempts,
        });

        if (!decision.nextRetryAtMs || decision.nextRetryAtMs <= nowMs) {
            return {
                allowed: true,
                reason: decision.action,
                nextRetryAtMs: decision.nextRetryAtMs,
            };
        }

        return {
            allowed: false,
            reason: 'retry_backoff',
            nextRetryAtMs: decision.nextRetryAtMs,
        };
    }

    return {
        shouldRetryNow,
        enqueueRecovery: (input) => queue.enqueue(input),
        drain: (timeoutMs) => queue.drain(timeoutMs),
        isFileOwned: (cameraId, filename) => queue.isOwned(keyFromCameraFile(cameraId, filename)),
        getStats: () => queue.getStats(),
    };
}

export default createRecordingRecoveryService();
