# Recording Zero-Bug Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the recording recovery, storage, and cleanup structure without increasing the chance of deleting active or recoverable recordings.

**Architecture:** Keep the current validated pipeline intact: FFmpeg writes pending partials, the recovery finalizer promotes validated final MP4 files, playback reads only `recording_segments`, and cleanup deletes only through the retention/safety boundary. The polish is surgical: first fix retry accounting and active-file safety, then extract scanner orchestration behind injected dependencies, then add read-only assurance and property tests.

**Tech Stack:** Node.js 20+, Fastify service modules, SQLite via `connectionPool.js`, Vitest, fast-check, filesystem mocks.

---

<!--
Purpose: Implementation plan for low-risk recording storage and cleanup polish after the May 17 hardening.
Caller: Agents implementing recording recovery, scanner, cleanup, and assurance follow-up work.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recording recovery services and tests.
MainFuncs: Documents exact tasks, safety gates, files, and test commands for zero-bug recording polish.
SideEffects: Documentation only.
-->

## Deep Analysis

Current recording structure is already split into the right core boundaries:

- `backend/services/recordingService.js`: facade and lifecycle compatibility surface.
- `backend/services/recordingCleanupService.js`: retention-aware destructive cleanup boundary.
- `backend/services/recordingRecoveryService.js`: bounded recovery queue and retry/terminal decision.
- `backend/services/recordingSegmentFinalizer.js`: finalization from pending/orphan files into playback-ready final MP4 rows.
- `backend/services/recordingFileOperationService.js`: safe delete/quarantine side-effect boundary.
- `backend/services/recordingRecoveryDiagnosticsRepository.js`: persistent recovery diagnostics.
- `backend/services/recordingScheduler.js`: timer lifecycle.

The remaining polish must not rewrite the pipeline. The safest useful work is:

1. Fix recovery retry accounting with DB-backed attempt counts, while explicitly not counting `file_still_changing` as a failed attempt. This prevents both infinite retry on corrupt files and accidental quarantine of active partials.
2. Extract the scanner from `recordingService.js` without changing decisions. The scanner is currently testable only through the large facade, so small future fixes are risky.
3. Add read-only assurance fields and property tests. These improve operator visibility and safety proof without changing destructive behavior.
4. Defer broad cleanup-orchestrator extraction until the retry and scanner gates are green. Emergency cleanup is safety-sensitive and should not be refactored in the same commit as retry semantics.

## Recommended Approach

Use surgical hardening.

- Pros: smallest behavioral surface, directly targets the only retry safety gap, keeps previously validated cleanup behavior.
- Cons: `recordingService.js` remains large until scanner extraction lands.

Rejected alternatives:

- Full recording rewrite: cleaner architecture, but too much risk around FFmpeg, retention, and emergency cleanup.
- Tests only: lowest code risk, but leaves the DB retry-count bug and scanner maintainability issue.
- Cleanup extraction first: improves structure, but touches the most destructive path before closing recovery accounting.

## File Structure

Create:

- `backend/services/recordingRecoveryScanner.js`: owns scanning camera directories, pending partials, final orphans, duplicate finalized partials, and failed-remux quarantine handoff. It must not delete final MP4 files.
- `backend/__tests__/recordingRecoveryScanner.test.js`: focused scanner tests with mocked filesystem, DB reads, file operations, and recovery ownership checks.

Modify:

- `backend/services/recordingRecoveryDiagnosticsRepository.js`: make `incrementAttempt()` return the active diagnostic row with the latest `attempt_count`; add `getOldestActive()` only when assurance needs it.
- `backend/services/recordingRecoveryService.js`: use repository attempt count for terminal decision; skip attempt increments for pending/in-progress reasons.
- `backend/services/recordingService.js`: delegate scanner behavior to `recordingRecoveryScanner.js` while preserving public method signatures.
- `backend/services/recordingAssuranceService.js`: optionally include read-only recovery age/count fields.
- `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`: cover returned attempt count.
- `backend/__tests__/recordingRecoveryService.test.js`: cover repeated calls without `input.attemptCount` and pending-file no-count behavior.
- `backend/__tests__/recordingService.test.js`: verify facade still starts scanner and preserves scheduler behavior.
- `backend/__tests__/recordingPathSafetyPolicy.test.js`: add fast-check path/range properties.
- `backend/__tests__/recordingTimePolicy.test.js`: add fast-check timestamp/age properties.
- `backend/services/.module_map.md`: update only after scanner extraction changes service ownership.

Do not modify:

- `backend/services/recordingCleanupService.js` destructive behavior in the same commit as retry accounting.
- Migrations, unless a new assurance aggregate needs a new index. Current indexes already cover `(camera_id, filename, active)`, `(camera_id, state, active)`, `(active, last_seen_at)`, and `(active, state, attempt_count)`.

## Safety Invariants

- Active or changing pending partials must never be quarantined because of retry exhaustion.
- A corrupt file may become terminal only after the persisted `attempt_count` reaches `maxAttempts`.
- Final MP4 filesystem orphans must be routed to recovery before any deletion decision.
- Final playback rows are deleted only after `recordingFileOperationService.deleteFileSafely()` succeeds.
- Direct `fsPromises.unlink()` remains allowed only inside `recordingSegmentFinalizer.js` for temp output and finalized partial source cleanup.
- `recordingService.js` public methods must keep the same names and call signatures.

## Task 1: Safe Recovery Attempt Accounting

**Files:**

- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
- Modify: `backend/services/recordingRecoveryService.js`
- Test: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`
- Test: `backend/__tests__/recordingRecoveryService.test.js`

- [ ] **Step 1: Write the failing repository test**

Update the connectionPool mock to include `queryOneMock`, then add this test:

```javascript
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
    queryOne: queryOneMock,
}));

it('returns the latest active attempt count after incrementing', async () => {
    queryOneMock.mockReturnValue({
        camera_id: 7,
        filename: '20260517_010000.mp4',
        state: 'retryable_failed',
        reason: 'invalid_duration',
        attempt_count: 2,
    });
    const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

    const row = repository.incrementAttempt({
        cameraId: 7,
        filename: '20260517_010000.mp4',
        filePath: 'C:\\recordings\\camera7\\20260517_010000.mp4',
        reason: 'invalid_duration',
        attemptedAt: '2026-05-17T01:30:00.000Z',
    });

    expect(row).toEqual(expect.objectContaining({
        camera_id: 7,
        filename: '20260517_010000.mp4',
        attempt_count: 2,
    }));
    expect(queryOneMock).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        [7, '20260517_010000.mp4']
    );
});
```

- [ ] **Step 2: Run the repository test and verify it fails**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js -t "returns the latest active attempt count after incrementing"
```

Expected: FAIL because `incrementAttempt()` currently returns the `execute()` result, not the latest active row.

- [ ] **Step 3: Implement the repository return row**

Change the repository import and method:

```javascript
import { execute, query, queryOne } from '../database/connectionPool.js';
```

Inside `incrementAttempt()`, keep the existing upsert, then return the active row:

```javascript
        execute(
            `INSERT INTO recording_recovery_diagnostics
            (camera_id, filename, file_path, state, reason, detected_at, last_seen_at, active, attempt_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)
            ON CONFLICT(camera_id, filename, active) DO UPDATE SET
                file_path = excluded.file_path,
                state = excluded.state,
                reason = excluded.reason,
                last_seen_at = excluded.last_seen_at,
                attempt_count = attempt_count + 1,
                updated_at = CURRENT_TIMESTAMP`,
            [cameraId, filename, filePath, 'retryable_failed', reason, attemptedAt, attemptedAt]
        );

        return queryOne(
            `SELECT camera_id, filename, file_path, state, reason, attempt_count, terminal_state, quarantined_path
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [cameraId, filename]
        );
```

- [ ] **Step 4: Run the repository test and verify it passes**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js
```

Expected: PASS.

- [ ] **Step 5: Write the failing recovery service tests**

Add these tests to `backend/__tests__/recordingRecoveryService.test.js`:

```javascript
it('uses persisted attempt count when repeated recovery calls omit input attemptCount', async () => {
    const finalizer = {
        finalizeSegment: vi.fn(async () => ({
            success: false,
            reason: 'invalid_duration',
            finalFilename: '20260517_010000.mp4',
        })),
    };
    const diagnosticsRepository = {
        incrementAttempt: vi.fn()
            .mockReturnValueOnce({ attempt_count: 1 })
            .mockReturnValueOnce({ attempt_count: 2 })
            .mockReturnValueOnce({ attempt_count: 3 }),
        markTerminal: vi.fn(),
        clearDiagnostic: vi.fn(),
    };
    const fileOperations = {
        quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
    };
    const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 3 });
    const input = {
        cameraId: 7,
        filename: '20260517_010000.mp4',
        sourcePath: 'final-path',
        sourceType: 'final_orphan',
    };

    await service.recoverNow(input);
    await service.recoverNow(input);
    const result = await service.recoverNow(input);

    expect(result).toMatchObject({ success: false, terminal: true, reason: 'invalid_duration' });
    expect(fileOperations.quarantineFile).toHaveBeenCalledTimes(1);
    expect(diagnosticsRepository.markTerminal).toHaveBeenCalledWith(expect.objectContaining({
        cameraId: 7,
        filename: '20260517_010000.mp4',
    }));
});

it('does not count file_still_changing as a failed recovery attempt', async () => {
    const finalizer = {
        finalizeSegment: vi.fn(async () => ({
            success: false,
            reason: 'file_still_changing',
            finalFilename: '20260517_010000.mp4',
        })),
    };
    const diagnosticsRepository = {
        incrementAttempt: vi.fn(),
        markTerminal: vi.fn(),
        clearDiagnostic: vi.fn(),
    };
    const fileOperations = {
        quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
    };
    const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 1 });

    const result = await service.recoverNow({
        cameraId: 7,
        filename: '20260517_010000.mp4.partial',
        sourcePath: 'pending-path',
        sourceType: 'partial',
    });

    expect(result).toMatchObject({
        success: false,
        terminal: false,
        reason: 'file_still_changing',
        pending: true,
    });
    expect(diagnosticsRepository.incrementAttempt).not.toHaveBeenCalled();
    expect(fileOperations.quarantineFile).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run recovery service tests and verify they fail**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js
```

Expected: FAIL because current logic uses `input.attemptCount` and counts every failed finalizer result.

- [ ] **Step 7: Implement safe retry accounting**

Add helper functions in `backend/services/recordingRecoveryService.js`:

```javascript
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
```

In both non-throw and catch branches, call `diagnosticsRepository.incrementAttempt()` only when `shouldCountRecoveryFailure(reason)` is true.

For a non-counted pending result, return:

```javascript
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
```

For counted failures, replace local attempt math with:

```javascript
            const diagnosticRow = diagnosticsRepository.incrementAttempt?.({
                cameraId: input.cameraId,
                filename: result?.finalFilename || finalFilename,
                filePath: input.sourcePath,
                reason,
            });
            const attemptCount = resolveAttemptCountAfterIncrement(input.attemptCount, diagnosticRow);
```

The terminal condition stays:

```javascript
            if (attemptCount < maxAttempts) {
                return {
                    ...(result || {}),
                    success: false,
                    terminal: false,
                    reason,
                    attemptCount,
                };
            }
```

- [ ] **Step 8: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js recordingRecoveryDiagnosticsRepository.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git status --short
git add backend/services/recordingRecoveryDiagnosticsRepository.js backend/services/recordingRecoveryService.js backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js backend/__tests__/recordingRecoveryService.test.js
git commit -m "Fix: harden recording recovery attempt accounting"
```

## Task 2: Extract Recording Recovery Scanner

**Files:**

- Create: `backend/services/recordingRecoveryScanner.js`
- Modify: `backend/services/recordingService.js`
- Modify: `backend/services/.module_map.md`
- Test: `backend/__tests__/recordingRecoveryScanner.test.js`
- Test: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Create scanner skeleton with Header Doc**

Create `backend/services/recordingRecoveryScanner.js`:

```javascript
// Purpose: Scan recording camera folders for pending partials, final orphans, and recoverable scanner work.
// Caller: recordingService startSegmentScanner facade.
// Deps: fs promises, connectionPool query helpers, segment file policy, file operation service, recovery service ownership checks.
// MainFuncs: createRecordingRecoveryScanner, scanOnce, start.
// SideEffects: Reads recording folders, deletes only finalized duplicate pending partials through safe delete, and calls injected recovery callbacks.

import { promises as fsPromises } from 'fs';
import { join } from 'path';
import { query, queryOne } from '../database/connectionPool.js';
import recordingFileOperationService from './recordingFileOperationService.js';
import recordingRecoveryService from './recordingRecoveryService.js';
import {
    getPendingRecordingDir,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';

export function createRecordingRecoveryScanner({
    recordingsBasePath,
    fs = fsPromises,
    queryRows = query,
    querySingle = queryOne,
    fileOperations = recordingFileOperationService,
    recoveryService = recordingRecoveryService,
    isFileBeingProcessed = () => false,
    isFileFailed = () => false,
    onFailedFileExpired = async () => ({ retained: true }),
    removeFailedFile = () => {},
    onSegmentCreated,
    logger = console,
} = {}) {
    if (!recordingsBasePath) {
        throw new Error('recordingsBasePath is required');
    }
    if (typeof onSegmentCreated !== 'function') {
        throw new Error('onSegmentCreated callback is required');
    }

    async function scanOnce() {
        return { scannedCameras: 0, queuedSegments: 0, duplicatePartialsDeleted: 0 };
    }

    function start(scheduleTimeout = setTimeout) {
        const scanCycle = async () => {
            await scanOnce();
            scheduleTimeout(scanCycle, 60000);
        };
        scheduleTimeout(scanCycle, 60000);
    }

    return { scanOnce, start };
}
```

- [ ] **Step 2: Write scanner tests for pending partial recovery and duplicate partial deletion**

Create `backend/__tests__/recordingRecoveryScanner.test.js`:

```javascript
/**
 * Purpose: Validate recording recovery scanner folder traversal and non-destructive recovery decisions.
 * Caller: Vitest backend test suite.
 * Deps: recordingRecoveryScanner with mocked fs, DB, file operations, and recovery ownership checks.
 * MainFuncs: scanOnce.
 * SideEffects: All filesystem and recovery side effects are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { createRecordingRecoveryScanner } from '../services/recordingRecoveryScanner.js';

const base = join(process.cwd(), '..', 'recordings');
const fsMock = {
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
};
const queryRows = vi.fn();
const querySingle = vi.fn();
const deleteFileSafely = vi.fn();
const isFileOwned = vi.fn();
const onSegmentCreated = vi.fn();

function createScanner() {
    return createRecordingRecoveryScanner({
        recordingsBasePath: base,
        fs: fsMock,
        queryRows,
        querySingle,
        fileOperations: { deleteFileSafely },
        recoveryService: { isFileOwned },
        isFileBeingProcessed: () => false,
        onSegmentCreated,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
}

describe('recordingRecoveryScanner', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fsMock.access.mockResolvedValue(undefined);
        fsMock.stat.mockResolvedValue({ isDirectory: () => true, mtimeMs: Date.now() - 60000, size: 1024 });
        fsMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath === base) return ['camera7'];
            if (targetPath === join(base, 'camera7')) return [];
            if (targetPath === join(base, 'camera7', 'pending')) return ['20260517_010000.mp4.partial'];
            return [];
        });
        querySingle.mockReturnValue({ id: 7, enable_recording: 0 });
        queryRows.mockReturnValue([]);
        deleteFileSafely.mockResolvedValue({ success: true, size: 1024 });
        isFileOwned.mockReturnValue(false);
    });

    it('queues old pending partials even when recording is disabled but the camera still exists', async () => {
        const scanner = createScanner();

        const result = await scanner.scanOnce();

        expect(onSegmentCreated).toHaveBeenCalledWith(7, '20260517_010000.mp4.partial');
        expect(result.queuedSegments).toBe(1);
    });

    it('deletes only finalized duplicate pending partials through safe delete', async () => {
        queryRows.mockReturnValueOnce([{ filename: '20260517_010000.mp4' }]);
        const scanner = createScanner();

        const result = await scanner.scanOnce();

        expect(deleteFileSafely).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            reason: 'pending_partial_finalized_duplicate',
        }));
        expect(onSegmentCreated).not.toHaveBeenCalled();
        expect(result.duplicatePartialsDeleted).toBe(1);
    });
});
```

- [ ] **Step 3: Run scanner tests and verify skeleton fails**

Run:

```bash
cd backend
npm test -- recordingRecoveryScanner.test.js
```

Expected: FAIL because `scanOnce()` is still a skeleton.

- [ ] **Step 4: Move scanner logic from recordingService into scanner**

Implement `scanOnce()` by moving the behavior currently inside `recordingService.startSegmentScanner()`:

```javascript
    async function scanOnce() {
        const result = { scannedCameras: 0, queuedSegments: 0, duplicatePartialsDeleted: 0 };

        try {
            await fs.access(recordingsBasePath);
        } catch {
            return result;
        }

        const cameraDirs = await fs.readdir(recordingsBasePath);
        for (const dirName of cameraDirs) {
            const cameraDir = join(recordingsBasePath, dirName);
            const stat = await fs.stat(cameraDir).catch(() => null);
            if (!stat?.isDirectory?.()) {
                continue;
            }

            const cameraIdMatch = dirName.match(/^camera(\d+)$/);
            if (!cameraIdMatch) {
                continue;
            }

            const cameraId = Number.parseInt(cameraIdMatch[1], 10);
            const camera = querySingle('SELECT id, enable_recording FROM cameras WHERE id = ?', [cameraId]);
            if (!camera) {
                continue;
            }

            result.scannedCameras += 1;
            const allFiles = await fs.readdir(cameraDir);
            const finalFiles = allFiles.filter(isFinalSegmentFilename);
            const pendingDir = getPendingRecordingDir(recordingsBasePath, cameraId);
            const partialFiles = await fs.readdir(pendingDir).then(
                (files) => files.filter(isPartialSegmentFilename),
                () => []
            );
            const existingFilesSet = new Set(
                queryRows('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                    .map((row) => row.filename)
            );

            for (const filename of partialFiles) {
                const finalFilename = toFinalSegmentFilename(filename);
                if (!finalFilename) {
                    continue;
                }

                const filePath = join(pendingDir, filename);
                const stats = await fs.stat(filePath);
                const fileAge = Date.now() - stats.mtimeMs;
                if (existingFilesSet.has(finalFilename)) {
                    if (fileAge > 5 * 60 * 1000) {
                        const deleteResult = await fileOperations.deleteFileSafely({
                            cameraId,
                            filename,
                            filePath,
                            reason: 'pending_partial_finalized_duplicate',
                        });
                        if (deleteResult.success) {
                            result.duplicatePartialsDeleted += 1;
                        }
                    }
                    continue;
                }

                const fileKey = `${cameraId}:${finalFilename}`;
                if (isFileBeingProcessed(fileKey) || recoveryService.isFileOwned(cameraId, finalFilename)) {
                    continue;
                }

                if (fileAge > 30000) {
                    onSegmentCreated(cameraId, filename);
                    result.queuedSegments += 1;
                }
            }

            for (const filename of finalFiles) {
                if (isFileFailed(cameraId, filename)) {
                    const filePath = join(cameraDir, filename);
                    try {
                        await fs.access(filePath);
                        await onFailedFileExpired(cameraId, filename, filePath, 'scanner_remux_failed_3x');
                    } catch {
                        removeFailedFile(cameraId, filename);
                    }
                    continue;
                }

                if (existingFilesSet.has(filename)) {
                    continue;
                }

                const filePath = join(cameraDir, filename);
                const stats = await fs.stat(filePath);
                const fileKey = `${cameraId}:${filename}`;
                if (isFileBeingProcessed(fileKey) || recoveryService.isFileOwned(cameraId, filename)) {
                    continue;
                }

                if (Date.now() - stats.mtimeMs > 30000) {
                    onSegmentCreated(cameraId, filename);
                    result.queuedSegments += 1;
                }
            }
        }

        return result;
    }
```

- [ ] **Step 5: Update `recordingService.js` facade wiring**

Import the scanner factory:

```javascript
import { createRecordingRecoveryScanner } from './recordingRecoveryScanner.js';
```

Create a scanner instance near `cleanupService`:

```javascript
const recoveryScanner = createRecordingRecoveryScanner({
    recordingsBasePath: RECORDINGS_BASE_PATH,
    isFileBeingProcessed: (fileKey) => filesBeingProcessed.has(fileKey),
    isFileFailed,
    onFailedFileExpired: quarantineFailedRemuxFileIfExpired,
    removeFailedFile,
    onSegmentCreated: (cameraId, filename) => recordingService.onSegmentCreated(cameraId, filename),
    logger: console,
});
```

Replace `startSegmentScanner()` body with:

```javascript
    startSegmentScanner(scheduleTimeout = setTimeout) {
        this.cleanupTempFiles();
        recoveryScanner.start(scheduleTimeout);
    }
```

If the module-level `recordingService` binding is not available at scanner construction time, create the scanner lazily inside `startSegmentScanner()` and cache it on `this.recoveryScanner`.

- [ ] **Step 6: Run scanner and facade tests**

Run:

```bash
cd backend
npm test -- recordingRecoveryScanner.test.js recordingService.test.js
```

Expected: PASS.

- [ ] **Step 7: Update services module map**

In `backend/services/.module_map.md`, change the recording domain bullets so `recordingRecoveryScanner.js` owns scanner traversal and `recordingService.js` remains the high-level facade.

- [ ] **Step 8: Commit Task 2**

Run:

```bash
git status --short
git add backend/services/recordingRecoveryScanner.js backend/services/recordingService.js backend/services/.module_map.md backend/__tests__/recordingRecoveryScanner.test.js backend/__tests__/recordingService.test.js
git commit -m "Refactor: isolate recording recovery scanner"
```

## Task 3: Add Read-Only Recovery Assurance Metrics

**Files:**

- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
- Modify: `backend/services/recordingAssuranceService.js`
- Test: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`
- Test: `backend/__tests__/recordingAssuranceService.test.js`

- [ ] **Step 1: Write repository aggregate test**

Add:

```javascript
it('returns oldest active recovery diagnostic metadata', async () => {
    queryOneMock.mockReturnValue({
        oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
        max_attempt_count: 3,
        active_total: 4,
    });
    const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

    const result = repository.getActiveHealthSummary();

    expect(result).toEqual({
        oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
        max_attempt_count: 3,
        active_total: 4,
    });
});
```

- [ ] **Step 2: Implement repository aggregate**

Add method:

```javascript
    getActiveHealthSummary() {
        return queryOne(
            `SELECT
                MIN(last_seen_at) as oldest_active_seen_at,
                MAX(attempt_count) as max_attempt_count,
                COUNT(*) as active_total
            FROM recording_recovery_diagnostics
            WHERE active = 1`,
            []
        ) || {
            oldest_active_seen_at: null,
            max_attempt_count: 0,
            active_total: 0,
        };
    }
```

- [ ] **Step 3: Write assurance test**

Add:

```javascript
it('includes recovery health metadata in assurance snapshot', () => {
    summarizeActiveMock.mockReturnValue({ pending: 2, retryable_failed: 1 });
    getActiveHealthSummaryMock.mockReturnValue({
        oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
        max_attempt_count: 2,
        active_total: 3,
    });
    queryMock.mockReturnValueOnce([]);

    const snapshot = recordingAssuranceService.getSnapshot();

    expect(snapshot.recoveryHealth).toEqual({
        oldest_active_seen_at: '2026-05-17T00:00:00.000Z',
        max_attempt_count: 2,
        active_total: 3,
    });
});
```

Update the repository mock in that test file:

```javascript
const getActiveHealthSummaryMock = vi.fn();

vi.mock('../services/recordingRecoveryDiagnosticsRepository.js', () => ({
    default: {
        summarizeActive: summarizeActiveMock,
        getActiveHealthSummary: getActiveHealthSummaryMock,
    },
}));
```

- [ ] **Step 4: Implement assurance field**

Update `makeEmptySnapshot()`:

```javascript
        recoveryDiagnostics: recordingRecoveryDiagnosticsRepository.summarizeActive(),
        recoveryHealth: recordingRecoveryDiagnosticsRepository.getActiveHealthSummary(),
```

- [ ] **Step 5: Run assurance tests**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js recordingAssuranceService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git status --short
git add backend/services/recordingRecoveryDiagnosticsRepository.js backend/services/recordingAssuranceService.js backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js backend/__tests__/recordingAssuranceService.test.js
git commit -m "Add: recording recovery assurance metrics"
```

## Task 4: Add Property-Based Safety Tests

**Files:**

- Modify: `backend/__tests__/recordingPathSafetyPolicy.test.js`
- Modify: `backend/__tests__/recordingTimePolicy.test.js`

- [ ] **Step 1: Add path safety properties**

Add import:

```javascript
import fc from 'fast-check';
```

Add tests:

```javascript
it('property: rejects filenames that do not exactly match the resolved basename', () => {
    fc.assert(fc.property(
        fc.string({ minLength: 1, maxLength: 80 }),
        (name) => {
            fc.pre(name !== '20260517_010000.mp4');
            expect(isSafeRecordingFilePath({
                recordingsBasePath: base,
                cameraId: 7,
                filePath: join(base, 'camera7', '20260517_010000.mp4'),
                filename: name,
            })).toBe(false);
        }
    ));
});

it('property: never returns an invalid normalized range with positive chunk size', () => {
    fc.assert(fc.property(
        fc.integer({ min: 1, max: 1000000 }),
        fc.integer({ min: 0, max: 1000000 }),
        fc.integer({ min: 0, max: 1000000 }),
        (fileSize, start, end) => {
            const range = normalizeRecordingRange({
                rangeHeader: `bytes=${start}-${end}`,
                fileSize,
            });

            if (range.valid) {
                expect(range.start).toBeGreaterThanOrEqual(0);
                expect(range.end).toBeLessThan(fileSize);
                expect(range.chunkSize).toBe(range.end - range.start + 1);
            } else {
                expect(range.statusCode).toBe(416);
            }
        }
    ));
});
```

- [ ] **Step 2: Add timestamp safety properties**

Add import:

```javascript
import fc from 'fast-check';
```

Add tests:

```javascript
it('property: parsed recording age is never negative', () => {
    fc.assert(fc.property(
        fc.integer({ min: 0, max: Date.UTC(2030, 0, 1) }),
        fc.integer({ min: 0, max: Date.UTC(2030, 0, 1) }),
        (fileMtimeMs, nowMs) => {
            const ageMs = getRecordingAgeMs({
                filename: '20260517_010203.mp4',
                startTime: '2026-05-17T01:02:03.000Z',
                fileMtimeMs,
                nowMs,
            });

            expect(ageMs).toBeGreaterThanOrEqual(0);
        }
    ));
});

it('property: path-like filenames never parse as recording timestamps', () => {
    fc.assert(fc.property(
        fc.constantFrom('../', '..\\', 'camera7/', 'camera7\\'),
        fc.constant('20260517_010203.mp4'),
        (prefix, filename) => {
            expect(parseRecordingFilenameTimestampMs(`${prefix}${filename}`)).toBe(null);
        }
    ));
});
```

- [ ] **Step 3: Run policy tests**

Run:

```bash
cd backend
npm test -- recordingPathSafetyPolicy.test.js recordingTimePolicy.test.js
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git status --short
git add backend/__tests__/recordingPathSafetyPolicy.test.js backend/__tests__/recordingTimePolicy.test.js
git commit -m "Add: recording safety property tests"
```

## Task 5: Final Verification Gate

**Files:**

- No new source files unless previous tasks required fixes.

- [ ] **Step 1: Run migration gate**

Run:

```bash
cd backend
npm run migrate
```

Expected: PASS with migrations applied or skipped idempotently.

- [ ] **Step 2: Run full backend test gate**

Run:

```bash
cd backend
npm test
```

Expected: PASS for all backend test files.

- [ ] **Step 3: Audit destructive recording operations**

Run:

```bash
Select-String -Path backend\services\*.js -Pattern 'unlink|deleteFileSafely|quarantineFile|rm' -Context 2,4
```

Expected:

- Destructive cleanup still flows through `recordingFileOperationService.deleteFileSafely()` or `quarantineFile()`.
- Direct `unlink` appears only in finalizer temp/source cleanup or unrelated safe code.
- No new direct final MP4 deletion path was introduced.

- [ ] **Step 4: Check git status**

Run:

```bash
git status --short
```

Expected: clean after all commits.

- [ ] **Step 5: Push**

Run:

```bash
git push origin main
```

Expected: branch `main` pushed successfully.

## Deferred Work

Do not do these in the first polish pass:

- Full `recordingCleanupOrchestrator.js` extraction. It is structurally useful but touches emergency cleanup and should wait until Task 1 through Task 5 are green.
- Changing finalizer temp/partial cleanup to use general safe-delete. Finalizer-owned temp cleanup is a valid narrow exception; broadening it can change behavior.
- Changing retention thresholds, grace periods, FFmpeg args, or segment naming.

## Self-Review

- Spec coverage: the plan covers retry accounting, active partial safety, scanner structure, assurance visibility, and safety properties.
- Placeholder scan: no unfinished marker text or deferred implementation holes are required for the first pass.
- Type consistency: task snippets use existing service names, existing Vitest style, existing DB helper names, and existing file policy functions.
- Risk control: no task adds a new direct deletion path; all destructive behavior stays behind current boundaries.
