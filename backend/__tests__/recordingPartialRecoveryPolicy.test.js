/**
 * Purpose: Verify pure retry/quarantine decisions for recording partial recovery.
 * Caller: Vitest recording recovery suite.
 * Deps: recordingPartialRecoveryPolicy.
 * MainFuncs: decideRecoveryRetry.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { decideRecoveryRetry } from '../services/recordingPartialRecoveryPolicy.js';

describe('recordingPartialRecoveryPolicy', () => {
    const nowMs = Date.parse('2026-05-17T21:20:00.000Z');

    it('keeps still-changing partial files pending without counting failure attempts', () => {
        const decision = decideRecoveryRetry({
            sourceType: 'partial',
            reason: 'file_still_changing',
            attemptCount: 7,
            nowMs,
        });

        expect(decision).toMatchObject({
            action: 'pending',
            shouldCountAttempt: false,
            shouldQuarantine: false,
        });
        expect(decision.nextRetryAtMs).toBe(nowMs + 60_000);
    });

    it('keeps failed partial media recovery retryable instead of terminal quarantine', () => {
        const decision = decideRecoveryRetry({
            sourceType: 'partial',
            reason: 'invalid_duration',
            attemptCount: 12,
            lastAttemptAtMs: nowMs - 5 * 60_000,
            nowMs,
        });

        expect(decision).toMatchObject({
            action: 'retry_later',
            shouldCountAttempt: true,
            shouldQuarantine: false,
        });
        expect(decision.nextRetryAtMs).toBeGreaterThan(nowMs);
    });

    it('lets cleanup own expired partial files instead of recovery quarantine', () => {
        const decision = decideRecoveryRetry({
            sourceType: 'partial',
            reason: 'remux_invalid_duration',
            attemptCount: 30,
            retentionExpiresAtMs: nowMs - 1,
            nowMs,
        });

        expect(decision).toMatchObject({
            action: 'retain_for_cleanup',
            shouldCountAttempt: false,
            shouldQuarantine: false,
        });
    });

    it('allows non-partial terminal quarantine after retry exhaustion', () => {
        const decision = decideRecoveryRetry({
            sourceType: 'final_orphan',
            reason: 'invalid_duration',
            attemptCount: 3,
            maxAttempts: 3,
            nowMs,
        });

        expect(decision).toMatchObject({
            action: 'terminal_quarantine',
            shouldCountAttempt: true,
            shouldQuarantine: true,
        });
    });
});
