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
            attemptCount: 5,
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

    it('NEVER quarantines a partial, no matter how many attempts have failed', () => {
        // The invariant the test above was written to protect, stated directly and
        // pushed far past the dormancy cap so it cannot be satisfied by coincidence.
        // Dormancy stops the RETRIES; it must never start deleting the file.
        for (const attemptCount of [12, 50, 500]) {
            const decision = decideRecoveryRetry({
                sourceType: 'partial',
                reason: 'invalid_duration',
                attemptCount,
                lastAttemptAtMs: nowMs - 5 * 60_000,
                nowMs,
            });
            expect(decision.shouldQuarantine).toBe(false);
            expect(decision.action).not.toBe('terminal_quarantine');
        }
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

    it('does NOT quarantine a non-partial on a TRANSIENT reason (probe timeout) — dormant, keeps file', () => {
        // The bug: an ffprobe/exec TIMEOUT under load was counted as corruption, burying a VALID final
        // orphan in .quarantine after 3 unlucky attempts. A transient reason (probe could not run) must
        // retain the file dormant, never quarantine.
        const decision = decideRecoveryRetry({
            sourceType: 'final_orphan',
            reason: 'Command failed: ffprobe -v error -show_entries format=duration ... (timed out)',
            attemptCount: 3, maxAttempts: 3, nowMs,
        });
        expect(decision.action).toBe('retain_dormant');
        expect(decision.shouldQuarantine).toBe(false); // valid footage MUST survive
        expect(decision.nextRetryAtMs).toBeNull();
    });

    it('still quarantines a non-partial on GENUINE corruption (moov atom / Invalid data)', () => {
        for (const reason of ['moov atom not found', 'ffprobe: Invalid data found when processing input']) {
            const d = decideRecoveryRetry({ sourceType: 'final_orphan', reason, attemptCount: 3, maxAttempts: 3, nowMs });
            expect(d.shouldQuarantine, reason).toBe(true);
        }
    });
});

describe('decideRecoveryRetry — dormancy cap for partials', () => {
    it('keeps retrying a partial below the cap', () => {
        const d = decideRecoveryRetry({
            sourceType: 'partial', reason: 'invalid_duration',
            attemptCount: 5, partialMaxAttempts: 12, nowMs: 1_000_000,
        });
        expect(d.action).toBe('retry_later');
        expect(d.shouldQuarantine).toBe(false);
    });

    it('goes DORMANT at the cap — stops retrying but never quarantines the file', () => {
        // The livelock fix. "Never quarantine a partial" was implemented as "retry
        // forever", which let 1,693 dead files starve fresh segments out of the queue.
        // Dormant = file untouched, retention still deletes it, it just leaves the queue.
        const d = decideRecoveryRetry({
            sourceType: 'partial', reason: 'invalid_duration',
            attemptCount: 12, partialMaxAttempts: 12, nowMs: 1_000_000,
        });
        expect(d.action).toBe('retain_dormant');
        expect(d.shouldQuarantine).toBe(false);   // file MUST survive
        expect(d.nextRetryAtMs).toBeNull();
    });

    it('retention expiry still wins over dormancy', () => {
        const d = decideRecoveryRetry({
            sourceType: 'partial', reason: 'invalid_duration',
            attemptCount: 99, partialMaxAttempts: 12,
            retentionExpiresAtMs: 500_000, nowMs: 1_000_000,
        });
        expect(d.action).toBe('retain_for_cleanup');
    });

    it('does not apply the partial cap to final orphans', () => {
        const d = decideRecoveryRetry({
            sourceType: 'final', reason: 'final_invalid_duration',
            attemptCount: 12, maxAttempts: 3, partialMaxAttempts: 12, nowMs: 1_000_000,
        });
        expect(d.action).toBe('terminal_quarantine');
    });
});
