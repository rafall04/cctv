<!--
Purpose: Implementation plan for hardening CCTV pending partial recording recovery without premature deletion or quarantine.
Caller: Agents and maintainers improving recording recovery for unstable/disconnecting cameras.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recording recovery services/tests.
MainFuncs: Documents current verification, target design, TDD tasks, file ownership, verification, and commit sequence.
SideEffects: None; documentation only.
-->

# Recording Partial Recovery Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `recordings/camera{id}/pending/*.mp4.partial` recovery safe for frequently disconnecting CCTV streams: recover valid partials quickly, retain failed partials until cleanup retention owns them, and expose clear diagnostics when a partial is stuck.

**Architecture:** Add one pure retry policy for partial recovery decisions, keep filesystem deletion in `recordingCleanupService.js`/`recordingFileOperationService.js`, and keep FFmpeg/ffprobe finalization in `recordingSegmentFinalizer.js`. `recordingRecoveryService.js` will coordinate attempts and diagnostics; `recordingRecoveryScanner.js` will discover partials and respect retry backoff so unstable cameras do not create a tight retry loop.

**Tech Stack:** Node.js ES modules, Vitest, SQLite via `connectionPool.js`, existing recording service/repository boundaries.

---

## Verification Already Completed

- Read required maps before analysis:
  - `SYSTEM_MAP.md`
  - `backend/.module_map.md`
  - `backend/services/.module_map.md`
- Local filesystem partial check:
  - Command: `Get-ChildItem .\recordings -Recurse -Filter *.partial -File`
  - Result: `partial_count=0` in this workspace.
- Local DB check for the reported timestamps:
  - `recording_segments` rows matching `%211000%`: `0`
  - `recording_recovery_diagnostics` rows matching `%211000%`: `0`
  - `recording_segments` rows matching `%211500%`: `0`
  - `recording_recovery_diagnostics` rows matching `%211500%`: `0`
- Focused partial/recovery/cleanup gate:
  - Command: `cd backend && npm test -- recordingRecoveryScanner.test.js recordingSegmentFinalizer.test.js recordingRecoveryService.test.js recordingCleanupService.test.js recordingService.test.js recordingRetentionPolicy.test.js recordingFileOperationService.test.js recordingSegmentFilePolicy.test.js`
  - Result: 8 test files passed, 90 tests passed.

## Current Behavior Summary

- FFmpeg writes active segments to `recordings/camera{id}/pending/%Y%m%d_%H%M%S.mp4.partial`.
- `recordingRecoveryScanner.js` scans all camera folders every 60 seconds and queues pending partials once file age is greater than 30 seconds.
- `recordingSegmentFinalizer.js` checks file stability, probes duration, remuxes to a temp MP4, promotes the final MP4, upserts `recording_segments`, then removes the partial source.
- `file_still_changing` is already safe: it stays pending and does not count as a failed attempt.
- `invalid_duration`, `remux_invalid_duration`, and `final_invalid_duration` currently count as failed attempts. After 3 counted attempts, `recordingRecoveryService.js` can quarantine the source through `recordingFileOperationService.js`.
- Cleanup already retains pending partials until retention plus grace and deletes them only through safe delete, but recovery can quarantine failed partials earlier than retention.

## Risk Decision

For frequently disconnecting CCTV streams, a `.partial` that remains for hours is not expected to "wait several hours then automatically become a final recording" by itself. In normal operation it should be discovered in about 60 seconds and either finalized, left pending because it is still changing, or marked retryable. If it is still present after hours, the likely causes are:

- scanner was not running or did not see the expected `camera{id}/pending` directory,
- finalizer repeatedly failed because the partial is corrupt/unfinalized,
- the file stayed open/changing,
- the file was outside the expected directory/name pattern,
- diagnostics exist but are not visible enough to the operator.

This plan keeps the safe part of the current design and removes the risky part: a pending partial from an unstable camera must not be terminal-quarantined just because 3 early probes failed. It should remain under retention cleanup, with backoff and diagnostics, so no valid recording evidence is removed prematurely.

## Files

- Create: `backend/services/recordingPartialRecoveryPolicy.js`
  - Pure decision policy for pending partial retry, backoff, and terminal quarantine eligibility.
- Create: `backend/__tests__/recordingPartialRecoveryPolicy.test.js`
  - Unit tests for policy behavior without filesystem or DB.
- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
  - Add active diagnostic lookup and return retry timing fields from `incrementAttempt()`.
- Modify: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`
  - Cover lookup and returned fields.
- Modify: `backend/services/recordingRecoveryService.js`
  - Use the policy before terminal quarantine; expose `shouldRetryNow()` for scanners.
- Modify: `backend/__tests__/recordingRecoveryService.test.js`
  - Cover partial retention after repeated media failures and final-orphan terminal quarantine.
- Modify: `backend/services/recordingRecoveryScanner.js`
  - Respect recovery backoff before requeueing partial/final orphan work.
- Modify: `backend/__tests__/recordingRecoveryScanner.test.js`
  - Cover retry skipped/due paths.
- Modify: `backend/services/recordingAssuranceService.js`
  - Add operator-visible partial recovery summary by camera from diagnostics.
- Modify: `backend/__tests__/recordingAssuranceService.test.js`
  - Cover pending/retryable diagnostics in assurance snapshot.
- Modify: `backend/services/.module_map.md`
  - Sync the recording invariant: partials are retained until retention cleanup owns deletion; recovery only quarantines non-partial terminal files.

No database migration is required. The existing `recording_recovery_diagnostics` columns provide `attempt_count`, `detected_at`, `last_seen_at`, and `updated_at`, which are enough to compute retry backoff.

---

### Task 1: Add Pure Partial Recovery Policy

**Files:**
- Create: `backend/services/recordingPartialRecoveryPolicy.js`
- Create: `backend/__tests__/recordingPartialRecoveryPolicy.test.js`

- [ ] **Step 1: Write failing policy tests**

Create `backend/__tests__/recordingPartialRecoveryPolicy.test.js`:

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingPartialRecoveryPolicy.test.js
```

Expected: FAIL because `backend/services/recordingPartialRecoveryPolicy.js` does not exist.

- [ ] **Step 3: Implement pure policy**

Create `backend/services/recordingPartialRecoveryPolicy.js`:

```javascript
// Purpose: Decide retry, retention, and quarantine behavior for recording recovery attempts.
// Caller: recordingRecoveryService and recordingRecoveryScanner.
// Deps: None.
// MainFuncs: decideRecoveryRetry, computeRetryDelayMs.
// SideEffects: None.

const STILL_CHANGING_REASONS = new Set([
    'file_still_changing',
]);

const PARTIAL_RETRY_REASONS = new Set([
    'invalid_duration',
    'remux_invalid_duration',
    'final_invalid_duration',
    'finalize_failed',
]);

const RETRY_BASE_MS = 60 * 1000;
const RETRY_CAP_MS = 30 * 60 * 1000;

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
    maxAttempts = 3,
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
```

- [ ] **Step 4: Run policy test**

Run:

```bash
cd backend
npm test -- recordingPartialRecoveryPolicy.test.js
```

Expected: PASS, 1 file passed.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingPartialRecoveryPolicy.js backend/__tests__/recordingPartialRecoveryPolicy.test.js
git commit -m "Add: recording partial recovery retry policy"
```

---

### Task 2: Add Diagnostic Lookup Needed For Retry Backoff

**Files:**
- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
- Modify: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`

- [ ] **Step 1: Add failing repository tests**

Append these tests to `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`:

```javascript
it('returns an active diagnostic by camera and filename', () => {
    repository.upsertDiagnostic({
        cameraId: 7,
        filename: '20260517_211000.mp4',
        filePath: 'C:\\recordings\\camera7\\pending\\20260517_211000.mp4.partial',
        state: 'retryable_failed',
        reason: 'invalid_duration',
        detectedAt: '2026-05-17T21:11:00.000Z',
        lastSeenAt: '2026-05-17T21:12:00.000Z',
    });

    const row = repository.getActiveDiagnostic({
        cameraId: 7,
        filename: '20260517_211000.mp4',
    });

    expect(row).toMatchObject({
        camera_id: 7,
        filename: '20260517_211000.mp4',
        state: 'retryable_failed',
        reason: 'invalid_duration',
    });
});

it('returns timing fields when incrementing recovery attempts', () => {
    const row = repository.incrementAttempt({
        cameraId: 7,
        filename: '20260517_211500.mp4',
        filePath: 'C:\\recordings\\camera7\\pending\\20260517_211500.mp4.partial',
        reason: 'invalid_duration',
        attemptedAt: '2026-05-17T21:16:00.000Z',
    });

    expect(row).toMatchObject({
        camera_id: 7,
        filename: '20260517_211500.mp4',
        reason: 'invalid_duration',
        attempt_count: 1,
    });
    expect(row.detected_at).toBeTruthy();
    expect(row.last_seen_at).toBeTruthy();
    expect(row.updated_at).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js
```

Expected: FAIL because `getActiveDiagnostic()` does not exist and `incrementAttempt()` does not return all timing fields.

- [ ] **Step 3: Implement lookup and return fields**

In `backend/services/recordingRecoveryDiagnosticsRepository.js`, add this method after `clearDiagnostic()`:

```javascript
    getActiveDiagnostic({ cameraId, filename }) {
        return queryOne(
            `SELECT *
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [cameraId, filename]
        );
    }
```

In `incrementAttempt()`, replace the final `SELECT` with:

```javascript
        return queryOne(
            `SELECT
                camera_id,
                filename,
                file_path,
                state,
                reason,
                detected_at,
                last_seen_at,
                updated_at,
                attempt_count,
                terminal_state,
                quarantined_path
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [cameraId, filename]
        );
```

- [ ] **Step 4: Run repository test**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingRecoveryDiagnosticsRepository.js backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js
git commit -m "Add: recording recovery diagnostic lookup"
```

---

### Task 3: Stop Premature Quarantine For Pending Partials

**Files:**
- Modify: `backend/services/recordingRecoveryService.js`
- Modify: `backend/__tests__/recordingRecoveryService.test.js`

- [ ] **Step 1: Add failing recovery service tests**

Add these tests to `backend/__tests__/recordingRecoveryService.test.js`:

```javascript
it('does not quarantine partial media failures after retry exhaustion', async () => {
    const finalizer = {
        finalizeSegment: vi.fn(async () => ({
            success: false,
            reason: 'invalid_duration',
            finalFilename: '20260517_211000.mp4',
        })),
    };
    const diagnosticsRepository = {
        incrementAttempt: vi.fn(() => ({
            attempt_count: 99,
            detected_at: '2026-05-17T21:11:00.000Z',
            last_seen_at: '2026-05-17T21:12:00.000Z',
            updated_at: '2026-05-17T21:12:00.000Z',
        })),
        clearDiagnostic: vi.fn(),
        markTerminal: vi.fn(),
        getActiveDiagnostic: vi.fn(() => null),
    };
    const fileOperations = {
        quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
    };
    const service = createRecordingRecoveryService({
        finalizer,
        diagnosticsRepository,
        fileOperations,
        maxAttempts: 3,
        logger: { warn: vi.fn() },
    });

    const result = await service.recoverNow({
        cameraId: 7,
        filename: '20260517_211000.mp4.partial',
        sourcePath: 'pending-path',
        sourceType: 'partial',
    });

    expect(result).toMatchObject({
        success: false,
        terminal: false,
        reason: 'invalid_duration',
    });
    expect(fileOperations.quarantineFile).not.toHaveBeenCalled();
    expect(diagnosticsRepository.markTerminal).not.toHaveBeenCalled();
});

it('still quarantines final orphan media failures after retry exhaustion', async () => {
    const finalizer = {
        finalizeSegment: vi.fn(async () => ({
            success: false,
            reason: 'invalid_duration',
            finalFilename: '20260517_211000.mp4',
        })),
    };
    const diagnosticsRepository = {
        incrementAttempt: vi.fn(() => ({
            attempt_count: 3,
            detected_at: '2026-05-17T21:11:00.000Z',
            last_seen_at: '2026-05-17T21:12:00.000Z',
            updated_at: '2026-05-17T21:12:00.000Z',
        })),
        clearDiagnostic: vi.fn(),
        markTerminal: vi.fn(),
        getActiveDiagnostic: vi.fn(() => null),
    };
    const fileOperations = {
        quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
    };
    const service = createRecordingRecoveryService({
        finalizer,
        diagnosticsRepository,
        fileOperations,
        maxAttempts: 3,
        logger: { warn: vi.fn() },
    });

    const result = await service.recoverNow({
        cameraId: 7,
        filename: '20260517_211000.mp4',
        sourcePath: 'final-path',
        sourceType: 'final_orphan',
    });

    expect(result).toMatchObject({
        success: false,
        terminal: true,
        reason: 'invalid_duration',
    });
    expect(fileOperations.quarantineFile).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js
```

Expected: FAIL because partial failures still terminal-quarantine after max attempts.

- [ ] **Step 3: Wire policy into recovery service**

In `backend/services/recordingRecoveryService.js`, import the policy:

```javascript
import { decideRecoveryRetry } from './recordingPartialRecoveryPolicy.js';
```

Add this helper inside `createRecordingRecoveryService()` before `runRecovery()`:

```javascript
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
```

In both `runRecovery()` failure paths, after `attemptCount` is resolved and before `handleTerminalFailure()`, use this decision:

```javascript
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
```

Keep `handleTerminalFailure()` only when `failureAction.shouldQuarantine` is true.

- [ ] **Step 4: Run recovery service test**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js recordingPartialRecoveryPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingRecoveryService.js backend/__tests__/recordingRecoveryService.test.js
git commit -m "Fix: retain failed recording partials for cleanup"
```

---

### Task 4: Add Scanner Retry Backoff

**Files:**
- Modify: `backend/services/recordingRecoveryService.js`
- Modify: `backend/services/recordingRecoveryScanner.js`
- Modify: `backend/__tests__/recordingRecoveryScanner.test.js`
- Modify: `backend/__tests__/recordingRecoveryService.test.js`

- [ ] **Step 1: Add failing scanner tests**

Add this test to `backend/__tests__/recordingRecoveryScanner.test.js`:

```javascript
it('skips pending partials that are not due for retry yet', async () => {
    const recoveryService = {
        isFileOwned: vi.fn(() => false),
        shouldRetryNow: vi.fn(() => ({
            allowed: false,
            reason: 'retry_backoff',
            nextRetryAtMs: Date.parse('2026-05-17T21:30:00.000Z'),
        })),
    };
    const scanner = createScanner({ recoveryService });

    const result = await scanner.scanOnce();

    expect(onSegmentCreated).not.toHaveBeenCalled();
    expect(result.retrySkipped).toBe(1);
});
```

Add this assertion to the existing "queues old pending partials" test:

```javascript
expect(result.retrySkipped).toBe(0);
```

- [ ] **Step 2: Add failing recovery service `shouldRetryNow()` tests**

Add this test to `backend/__tests__/recordingRecoveryService.test.js`:

```javascript
it('reports retry backoff from active diagnostics', () => {
    const diagnosticsRepository = {
        getActiveDiagnostic: vi.fn(() => ({
            camera_id: 7,
            filename: '20260517_211000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
            attempt_count: 3,
            last_seen_at: '2026-05-17T21:10:00.000Z',
        })),
        incrementAttempt: vi.fn(),
        clearDiagnostic: vi.fn(),
        markTerminal: vi.fn(),
    };
    const service = createRecordingRecoveryService({
        diagnosticsRepository,
        fileOperations: { quarantineFile: vi.fn() },
        logger: { warn: vi.fn() },
    });

    const decision = service.shouldRetryNow({
        cameraId: 7,
        filename: '20260517_211000.mp4.partial',
        sourceType: 'partial',
        nowMs: Date.parse('2026-05-17T21:11:00.000Z'),
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('retry_backoff');
    expect(decision.nextRetryAtMs).toBeGreaterThan(Date.parse('2026-05-17T21:11:00.000Z'));
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingRecoveryScanner.test.js recordingRecoveryService.test.js
```

Expected: FAIL because `shouldRetryNow()` and `retrySkipped` do not exist.

- [ ] **Step 4: Implement `shouldRetryNow()`**

In `backend/services/recordingRecoveryService.js`, add this method to the returned object before `enqueue(input)`:

```javascript
        shouldRetryNow({ cameraId, filename, sourceType, nowMs = Date.now() }) {
            const finalFilename = toFinalSegmentFilename(filename) || filename;
            const diagnostic = diagnosticsRepository.getActiveDiagnostic?.({
                cameraId,
                filename: finalFilename,
            });

            if (!diagnostic) {
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
```

- [ ] **Step 5: Make scanner respect retry due checks**

In `backend/services/recordingRecoveryScanner.js`, initialize scan result with `retrySkipped`:

```javascript
        const result = {
            scannedCameras: 0,
            queuedSegments: 0,
            duplicatePartialsDeleted: 0,
            retrySkipped: 0,
        };
```

In `scanPendingPartials()`, before calling `onSegmentCreated(cameraId, filename)`, add:

```javascript
                const retryDecision = recoveryService.shouldRetryNow?.({
                    cameraId,
                    filename,
                    sourceType: 'partial',
                    nowMs: nowMs(),
                }) || { allowed: true };

                if (!retryDecision.allowed) {
                    result.retrySkipped += 1;
                    continue;
                }
```

In `scanFinalFiles()`, before queuing final orphan recovery, add the same check with `sourceType: 'final_orphan'`.

- [ ] **Step 6: Run scanner/recovery tests**

Run:

```bash
cd backend
npm test -- recordingRecoveryScanner.test.js recordingRecoveryService.test.js recordingService.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/recordingRecoveryService.js backend/services/recordingRecoveryScanner.js backend/__tests__/recordingRecoveryService.test.js backend/__tests__/recordingRecoveryScanner.test.js
git commit -m "Fix: back off recording partial recovery retries"
```

---

### Task 5: Expose Stuck Partial Diagnostics In Assurance Snapshot

**Files:**
- Modify: `backend/services/recordingAssuranceService.js`
- Modify: `backend/__tests__/recordingAssuranceService.test.js`

- [ ] **Step 1: Add failing assurance test**

Add this test to `backend/__tests__/recordingAssuranceService.test.js`:

```javascript
it('includes active partial recovery diagnostics in camera assurance', () => {
    queryMock.mockImplementation((sql) => {
        if (sql.includes('FROM cameras c')) {
            return [{
                id: 7,
                name: 'CCTV Pasar',
                stream_source: 'internal',
                recording_status: 'recording',
                last_recording_start: '2026-05-17T21:00:00.000Z',
            }];
        }
        if (sql.includes('ranked_segments')) {
            return [];
        }
        if (sql.includes('ordered_segments')) {
            return [];
        }
        return [];
    });
    diagnosticsRepositoryMock.listActiveByCamera.mockReturnValue([{
        camera_id: 7,
        filename: '20260517_211000.mp4',
        file_path: 'C:\\recordings\\camera7\\pending\\20260517_211000.mp4.partial',
        state: 'retryable_failed',
        reason: 'invalid_duration',
        attempt_count: 4,
        last_seen_at: '2026-05-17T21:15:00.000Z',
    }]);

    const snapshot = service.getSnapshot({
        now: new Date('2026-05-17T21:20:00.000Z'),
    });

    expect(snapshot.cameras[0].recovery_diagnostics).toEqual([expect.objectContaining({
        filename: '20260517_211000.mp4',
        state: 'retryable_failed',
        reason: 'invalid_duration',
        attempt_count: 4,
    })]);
    expect(snapshot.cameras[0].reasons).toContain('recording_recovery_attention');
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd backend
npm test -- recordingAssuranceService.test.js
```

Expected: FAIL because per-camera recovery diagnostics are not included.

- [ ] **Step 3: Add diagnostics to assurance camera rows**

In `backend/services/recordingAssuranceService.js`, inside `snapshot.cameras = cameras.map((camera) => {`, after `const reasons = [];`, add:

```javascript
            const recoveryDiagnostics = recordingRecoveryDiagnosticsRepository.listActiveByCamera(camera.id, 10);
            if (recoveryDiagnostics.some((diagnostic) => diagnostic.state === 'retryable_failed' || diagnostic.state === 'pending')) {
                reasons.push('recording_recovery_attention');
            }
```

In the returned camera object, add:

```javascript
                recovery_diagnostics: recoveryDiagnostics.map((diagnostic) => ({
                    filename: diagnostic.filename,
                    state: diagnostic.state,
                    reason: diagnostic.reason,
                    attempt_count: Number(diagnostic.attempt_count || 0),
                    last_seen_at: diagnostic.last_seen_at,
                    file_path: diagnostic.file_path,
                })),
```

- [ ] **Step 4: Run assurance test**

Run:

```bash
cd backend
npm test -- recordingAssuranceService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingAssuranceService.js backend/__tests__/recordingAssuranceService.test.js
git commit -m "Add: recording partial recovery assurance diagnostics"
```

---

### Task 6: Sync Documentation Maps

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update recording invariant**

In `backend/services/.module_map.md`, update the recording cleanup invariant sentence so it states:

```markdown
  - Recording cleanup invariant: all destructive cleanup paths must flow through `recordingCleanupService.js` and `recordingRetentionPolicy.js`; pending `.mp4.partial` recovery files from unstable connectivity must not be terminal-quarantined by recovery before retention cleanup owns their deletion. Final `.mp4` orphans can be quarantined only after retry exhaustion; final `.mp4` orphans must receive a recovery/finalizer pass before permanent deletion, while pending partials are retried with backoff and retained until retention plus grace expires.
```

- [ ] **Step 2: Run documentation check**

Run:

```bash
git diff -- backend/services/.module_map.md
```

Expected: diff contains only the recording invariant update.

- [ ] **Step 3: Commit**

```bash
git add backend/services/.module_map.md
git commit -m "Add: recording partial recovery invariant docs"
```

---

### Task 7: Focused Verification

**Files:**
- No source edits.

- [ ] **Step 1: Run focused partial recovery gate**

Run:

```bash
cd backend
npm test -- recordingPartialRecoveryPolicy.test.js recordingRecoveryDiagnosticsRepository.test.js recordingRecoveryService.test.js recordingRecoveryScanner.test.js recordingSegmentFinalizer.test.js recordingCleanupService.test.js recordingService.test.js recordingAssuranceService.test.js recordingRetentionPolicy.test.js recordingFileOperationService.test.js recordingSegmentFilePolicy.test.js
```

Expected: all listed test files pass.

- [ ] **Step 2: Run full backend migration and test gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected:
- migrations complete successfully,
- 0 failed test files,
- 0 failed tests.

- [ ] **Step 3: Verify destructive operation boundary**

Run:

```bash
rg -n "deleteFileSafely|quarantineFile|unlink\\(|fs\\.unlink|fsPromises\\.unlink|rm\\(|deleteSegmentById|canDeleteRecordingFile" backend/services --glob "recording*.js"
```

Expected:
- raw `unlink` remains only in `recordingFileOperationService.js` and `recordingSegmentFinalizer.js` temp/source cleanup,
- pending partial deletion remains only under safe cleanup paths,
- no new direct delete path appears in scanner or recovery service.

- [ ] **Step 4: Verify git state**

Run:

```bash
git status --short --branch
```

Expected: only intended committed changes are present, or worktree is clean after commits.

---

### Task 8: Production Read-Only Partial Triage Procedure

**Files:**
- No source edits.

- [ ] **Step 1: Count current partials on the production host**

Run from the project root on the production machine:

```bash
find recordings -path "*/pending/*.mp4.partial" -type f -printf "%TY-%Tm-%Td %TH:%TM:%TS %s %p\n" | sort
```

Expected:
- if no rows appear, no partial files are currently stuck,
- if rows appear older than 5 minutes, proceed to diagnostics.

- [ ] **Step 2: Check diagnostics for the exact timestamp**

For a partial named `20260517_211000.mp4.partial`, run:

```bash
cd backend
node - <<'NODE'
const Database = require('better-sqlite3');
const db = new Database('data/cctv.db', { readonly: true });
for (const filename of ['20260517_211000.mp4', '20260517_211500.mp4']) {
  const segments = db.prepare('SELECT camera_id, filename, start_time, end_time, duration, file_size, file_path FROM recording_segments WHERE filename = ? ORDER BY camera_id').all(filename);
  const diagnostics = db.prepare('SELECT camera_id, filename, state, reason, attempt_count, detected_at, last_seen_at, updated_at, file_path, quarantined_path FROM recording_recovery_diagnostics WHERE filename = ? AND active = 1 ORDER BY camera_id').all(filename);
  console.log(JSON.stringify({ filename, segments, diagnostics }, null, 2));
}
db.close();
NODE
```

Expected:
- `segments` row exists: the partial was already finalized; stale duplicate partial can be cleaned by the safe duplicate path.
- `diagnostics.state = pending`: file is still changing or waiting.
- `diagnostics.state = retryable_failed`: finalizer attempted it but media validation/remux failed; after this plan it stays retained with backoff.
- no segment and no diagnostic for an old partial: scanner is not seeing it or background scanner is not running.

- [ ] **Step 3: Check whether the partial is recoverable**

Run:

```bash
ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 "recordings/camera7/pending/20260517_211000.mp4.partial"
```

Expected:
- numeric duration: file is likely recoverable and should finalize on next due scanner run,
- ffprobe error or empty output: file may be corrupt/unfinalized; it should be retained with diagnostics until retention cleanup, not deleted early.

---

## Execution Notes

- Do not change FFmpeg segment output naming in this plan.
- Do not add a new DB table in this plan.
- Do not delete or move existing production partial files manually during implementation.
- Do not broaden cleanup deletion rules. The desired safety rule is stricter: recovery cannot terminal-quarantine pending partial files before retention cleanup owns their lifecycle.

## Final Verification And Push

After all tasks pass:

```bash
git status --short --branch
git log --oneline -5
git push origin main
```

Expected:
- branch is `main`,
- worktree is clean,
- all task commits are present,
- push succeeds.
