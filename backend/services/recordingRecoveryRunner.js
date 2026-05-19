// Purpose: Execute one recording recovery attempt: call finalizer, write diagnostics, decide retry/terminal,
//          and quarantine when terminal.
// Caller: recordingRecoveryService (wraps this with recordingRecoveryQueue for concurrency).
// Deps: recordingSegmentFinalizer, recordingRecoveryDiagnosticsRepository, recordingFileOperationService,
//        recordingPartialRecoveryPolicy.
// MainFuncs: createRecordingRecoveryRunner → runRecovery.
// SideEffects: Calls finalizer (spawns ffmpeg/ffprobe), writes diagnostics rows, quarantines files on terminal failure.

import { decideRecoveryRetry } from './recordingPartialRecoveryPolicy.js';
import { toFinalSegmentFilename } from './recordingSegmentFilePolicy.js';
import { RECORDING_RECOVERY_MAX_ATTEMPTS } from './recordingIntervalsPolicy.js';

const PENDING_RECOVERY_REASONS = new Set(['file_still_changing']);

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

function parseLastAttemptMs(diagnosticRow) {
    const ms = Date.parse(
        diagnosticRow?.last_seen_at
        || diagnosticRow?.updated_at
        || diagnosticRow?.detected_at
        || ''
    );
    return Number.isFinite(ms) ? ms : null;
}

export function createRecordingRecoveryRunner({
    finalizer,
    diagnosticsRepository,
    fileOperations,
    maxAttempts = RECORDING_RECOVERY_MAX_ATTEMPTS,
    logger = console,
} = {}) {
    if (!finalizer?.finalizeSegment) {
        throw new Error('recordingRecoveryRunner requires finalizer with finalizeSegment()');
    }
    if (!diagnosticsRepository) {
        throw new Error('recordingRecoveryRunner requires diagnosticsRepository');
    }
    if (!fileOperations?.quarantineFile) {
        throw new Error('recordingRecoveryRunner requires fileOperations.quarantineFile');
    }

    function decideFailureAction({ input, reason, attemptCount, diagnosticRow }) {
        return decideRecoveryRetry({
            sourceType: input.sourceType,
            reason,
            attemptCount,
            lastAttemptAtMs: parseLastAttemptMs(diagnosticRow),
            maxAttempts,
        });
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

    function buildPendingResult(input, reason, baseResult = {}) {
        return {
            ...baseResult,
            success: false,
            terminal: false,
            pending: true,
            reason,
            attemptCount: Number(input.attemptCount || 0),
        };
    }

    function buildRetryableResult(baseResult, reason, attemptCount) {
        return {
            ...baseResult,
            success: false,
            terminal: false,
            reason,
            attemptCount,
        };
    }

    async function processFailure({ input, finalFilename, reason, baseResult }) {
        const diagnosticRow = diagnosticsRepository.incrementAttempt?.({
            cameraId: input.cameraId,
            filename: finalFilename,
            filePath: input.sourcePath,
            reason,
        });
        const attemptCount = resolveAttemptCountAfterIncrement(input.attemptCount, diagnosticRow);

        if (attemptCount < maxAttempts) {
            return buildRetryableResult(baseResult, reason, attemptCount);
        }

        const failureAction = decideFailureAction({ input, reason, attemptCount, diagnosticRow });

        if (!failureAction.shouldQuarantine) {
            return {
                ...baseResult,
                success: false,
                terminal: false,
                pending: failureAction.action === 'pending',
                reason,
                attemptCount,
                nextRetryAtMs: failureAction.nextRetryAtMs,
            };
        }

        return handleTerminalFailure(input, finalFilename, reason, baseResult);
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
                return buildPendingResult(input, reason, result || {});
            }

            return processFailure({
                input,
                finalFilename: result?.finalFilename || finalFilename,
                reason,
                baseResult: result || {},
            });
        } catch (error) {
            const reason = error.message || 'recovery_exception';
            if (!shouldCountRecoveryFailure(reason)) {
                return buildPendingResult(input, reason);
            }

            logger.warn?.(`[Recovery] Retryable recovery failure for camera${input.cameraId}/${finalFilename}: ${reason}`);
            return processFailure({
                input,
                finalFilename,
                reason,
                baseResult: {},
            });
        }
    }

    return { runRecovery };
}
