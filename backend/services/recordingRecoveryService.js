// Purpose: Own bounded recording file recovery, finalizer delegation, retry limits, and terminal recovery state.
// Caller: recordingService scanners and recordingCleanupService orphan reconciliation.
// Deps: recordingSegmentFinalizer, recordingRecoveryDiagnosticsRepository, recordingFileOperationService.
// MainFuncs: createRecordingRecoveryService, enqueue, recoverNow, drain, isFileOwned.
// SideEffects: Starts bounded FFmpeg/ffprobe recovery work and may quarantine terminal files.

import recordingFileOperationService from './recordingFileOperationService.js';
import { decideRecoveryRetry } from './recordingPartialRecoveryPolicy.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import { toFinalSegmentFilename } from './recordingSegmentFilePolicy.js';

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const PENDING_RECOVERY_REASONS = new Set([
    'file_still_changing',
]);

function shouldCountRecoveryFailure(reason) {
    return !PENDING_RECOVERY_REASONS.has(reason);
}

function resolveAttemptCountAfterIncrement(inputAttemptCount, diagnosticRow) {
    const persistedAttemptCount = Number(diagnosticRow?.attempt_count);
    if (Number.isFinite(persistedAttemptCount) && persistedAttemptCount > 0) {
        return persistedAttemptCount;
    }

    return Number(inputAttemptCount || 0) + 1;
}

export function createRecordingRecoveryService({
    finalizer = recordingSegmentFinalizer,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    fileOperations = recordingFileOperationService,
    maxConcurrent = 3,
    maxAttempts = 3,
    logger = console,
} = {}) {
    const queue = [];
    const queuedKeys = new Set();
    const inFlight = new Map();
    let activeCount = 0;

    function keyFor(inputOrCameraId, filename = null) {
        if (typeof inputOrCameraId === 'object' && inputOrCameraId !== null) {
            const finalFilename = toFinalSegmentFilename(inputOrCameraId.filename) || inputOrCameraId.filename;
            return `${inputOrCameraId.cameraId}:${finalFilename}`;
        }

        const finalFilename = toFinalSegmentFilename(filename) || filename;
        return `${inputOrCameraId}:${finalFilename}`;
    }

    async function handleTerminalFailure(input, finalFilename, reason, failureResult) {
        const quarantineResult = await fileOperations.quarantineFile({
            cameraId: input.cameraId,
            filename: finalFilename,
            filePath: input.sourcePath,
            reason: 'terminal_recovery_failed',
        });

        diagnosticsRepository.markTerminal({
            cameraId: input.cameraId,
            filename: finalFilename,
            reason,
            terminalState: 'unrecoverable',
            quarantinedPath: quarantineResult.path || null,
        });

        return {
            ...failureResult,
            success: false,
            terminal: true,
            reason,
            quarantinedPath: quarantineResult.path || null,
        };
    }

    function decideFailureAction({ input, reason, attemptCount, diagnosticRow }) {
        const lastAttemptAtMs = Date.parse(
            diagnosticRow?.last_seen_at
            || diagnosticRow?.updated_at
            || diagnosticRow?.detected_at
            || ''
        );

        return decideRecoveryRetry({
            sourceType: input.sourceType,
            reason,
            attemptCount,
            lastAttemptAtMs: Number.isFinite(lastAttemptAtMs) ? lastAttemptAtMs : null,
            maxAttempts,
        });
    }

    async function runRecovery(input) {
        const finalFilename = toFinalSegmentFilename(input.filename) || input.filename;

        try {
            const result = await finalizer.finalizeSegment(input);
            if (result?.success) {
                diagnosticsRepository.clearDiagnostic?.({
                    cameraId: input.cameraId,
                    filename: result.finalFilename || finalFilename,
                });
                return result;
            }

            const reason = result?.reason || 'recovery_failed';
            if (!shouldCountRecoveryFailure(reason)) {
                return {
                    ...(result || {}),
                    success: false,
                    terminal: false,
                    pending: true,
                    reason,
                    attemptCount: Number(input.attemptCount || 0),
                };
            }

            const diagnosticRow = diagnosticsRepository.incrementAttempt?.({
                cameraId: input.cameraId,
                filename: result?.finalFilename || finalFilename,
                filePath: input.sourcePath,
                reason,
            });
            const attemptCount = resolveAttemptCountAfterIncrement(input.attemptCount, diagnosticRow);

            if (attemptCount < maxAttempts) {
                return {
                    ...(result || {}),
                    success: false,
                    terminal: false,
                    reason,
                    attemptCount,
                };
            }

            const failureAction = decideFailureAction({
                input,
                reason,
                attemptCount,
                diagnosticRow,
            });

            if (!failureAction.shouldQuarantine) {
                return {
                    ...(result || {}),
                    success: false,
                    terminal: false,
                    pending: failureAction.action === 'pending',
                    reason,
                    attemptCount,
                    nextRetryAtMs: failureAction.nextRetryAtMs,
                };
            }

            return handleTerminalFailure(input, result?.finalFilename || finalFilename, reason, result || {});
        } catch (error) {
            const reason = error.message || 'recovery_exception';
            if (!shouldCountRecoveryFailure(reason)) {
                return {
                    success: false,
                    terminal: false,
                    pending: true,
                    reason,
                    attemptCount: Number(input.attemptCount || 0),
                };
            }

            const diagnosticRow = diagnosticsRepository.incrementAttempt?.({
                cameraId: input.cameraId,
                filename: finalFilename,
                filePath: input.sourcePath,
                reason,
            });
            const attemptCount = resolveAttemptCountAfterIncrement(input.attemptCount, diagnosticRow);

            if (attemptCount < maxAttempts) {
                logger.warn?.(`[Recovery] Retryable recovery failure for camera${input.cameraId}/${finalFilename}: ${reason}`);
                return { success: false, terminal: false, reason, attemptCount };
            }

            const failureAction = decideFailureAction({
                input,
                reason,
                attemptCount,
                diagnosticRow,
            });

            if (!failureAction.shouldQuarantine) {
                return {
                    success: false,
                    terminal: false,
                    pending: failureAction.action === 'pending',
                    reason,
                    attemptCount,
                    nextRetryAtMs: failureAction.nextRetryAtMs,
                };
            }

            return handleTerminalFailure(input, finalFilename, reason, {});
        }
    }

    function recoverNow(input) {
        const key = keyFor(input);
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }

        const promise = runRecovery(input).finally(() => {
            inFlight.delete(key);
        });
        inFlight.set(key, promise);
        return promise;
    }

    function pump() {
        while (activeCount < maxConcurrent && queue.length > 0) {
            const job = queue.shift();
            queuedKeys.delete(job.key);
            activeCount += 1;
            recoverNow(job.input).finally(() => {
                activeCount -= 1;
                pump();
            });
        }
    }

    return {
        shouldRetryNow({ cameraId, filename, sourceType, nowMs = Date.now() }) {
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
        },
        enqueue(input) {
            const key = keyFor(input);
            if (queuedKeys.has(key) || inFlight.has(key)) {
                return { queued: false, duplicate: true, key };
            }

            queuedKeys.add(key);
            queue.push({ key, input });
            pump();
            return { queued: true, key };
        },
        recoverNow,
        async drain(timeoutMs = 30000) {
            const deadline = Date.now() + timeoutMs;
            while (queue.length > 0 || activeCount > 0 || inFlight.size > 0) {
                if (Date.now() > deadline) {
                    throw new Error('recordingRecoveryService.drain timeout');
                }
                await sleep(25);
            }
        },
        isFileOwned(cameraId, filename) {
            const key = keyFor(cameraId, filename);
            return queuedKeys.has(key) || inFlight.has(key);
        },
    };
}

export default createRecordingRecoveryService();
