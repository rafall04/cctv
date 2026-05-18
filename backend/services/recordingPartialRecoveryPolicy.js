// Purpose: Decide retry, retention, and quarantine behavior for recording recovery attempts.
// Caller: recordingRecoveryService and recordingRecoveryScanner.
// Deps: None.
// MainFuncs: decideRecoveryRetry, computeRetryDelayMs.
// SideEffects: None.

import {
    RECORDING_RECOVERY_MAX_ATTEMPTS,
    RECORDING_RECOVERY_RETRY_BASE_MS as RETRY_BASE_MS,
    RECORDING_RECOVERY_RETRY_CAP_MS as RETRY_CAP_MS,
} from './recordingIntervalsPolicy.js';

const STILL_CHANGING_REASONS = new Set([
    'file_still_changing',
]);

const PARTIAL_RETRY_REASONS = new Set([
    'invalid_duration',
    'remux_invalid_duration',
    'final_invalid_duration',
    'finalize_failed',
]);

export function computeRetryDelayMs(attemptCount = 0) {
    const normalizedAttempt = Math.max(0, Number(attemptCount) || 0);
    const exponent = Math.min(normalizedAttempt, 5);
    return Math.min(RETRY_BASE_MS * (2 ** exponent), RETRY_CAP_MS);
}

export function decideRecoveryRetry({
    sourceType,
    reason,
    attemptCount = 0,
    lastAttemptAtMs = null,
    retentionExpiresAtMs = null,
    maxAttempts = RECORDING_RECOVERY_MAX_ATTEMPTS,
    nowMs = Date.now(),
} = {}) {
    if (STILL_CHANGING_REASONS.has(reason)) {
        return {
            action: 'pending',
            shouldCountAttempt: false,
            shouldQuarantine: false,
            nextRetryAtMs: nowMs + RETRY_BASE_MS,
        };
    }

    if (sourceType === 'partial') {
        if (Number.isFinite(retentionExpiresAtMs) && nowMs >= retentionExpiresAtMs) {
            return {
                action: 'retain_for_cleanup',
                shouldCountAttempt: false,
                shouldQuarantine: false,
                nextRetryAtMs: null,
            };
        }

        const delayMs = PARTIAL_RETRY_REASONS.has(reason)
            ? computeRetryDelayMs(attemptCount)
            : computeRetryDelayMs(Math.max(1, attemptCount));
        const anchorMs = Number.isFinite(lastAttemptAtMs) ? lastAttemptAtMs : nowMs;

        return {
            action: 'retry_later',
            shouldCountAttempt: true,
            shouldQuarantine: false,
            nextRetryAtMs: anchorMs + delayMs,
        };
    }

    if (Number(attemptCount || 0) >= maxAttempts) {
        return {
            action: 'terminal_quarantine',
            shouldCountAttempt: true,
            shouldQuarantine: true,
            nextRetryAtMs: null,
        };
    }

    const delayMs = computeRetryDelayMs(attemptCount);
    const anchorMs = Number.isFinite(lastAttemptAtMs) ? lastAttemptAtMs : nowMs;

    return {
        action: 'retry_later',
        shouldCountAttempt: true,
        shouldQuarantine: false,
        nextRetryAtMs: anchorMs + delayMs,
    };
}
