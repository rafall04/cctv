<!--
Purpose: Implementation plan for safe retention cleanup of stale pending recording partial files.
Caller: Agents and maintainers fixing recording cleanup without changing playback behavior.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recording cleanup tests.
MainFuncs: Documents TDD tasks, target files, verification, and commit sequence.
SideEffects: None; documentation only.
-->

# Pending Partial Retention Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete stale `recordings/camera{id}/pending/*.mp4.partial` files only after retention plus grace expires, while preserving active recovery and avoiding accidental deletion of valid recordings.

**Architecture:** Keep destructive cleanup owned by `recordingCleanupService.js` and pure retention decisions owned by `recordingRetentionPolicy.js`. The scanner remains responsible for discovering and finalizing partials; cleanup only handles pending partial files after the same retention boundary used for final files.

**Tech Stack:** Node.js ES modules, Fastify backend service layer, Vitest, filesystem abstraction injected into `recordingCleanupService`.

---

## Verification Already Completed

- Current focused baseline passes before implementation:
  - `cd backend && npm test -- recordingCleanupService.test.js recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js`
  - Result: 3 test files passed, 30 tests passed.
- Root cause confirmed with injected cleanup run:
  - `cleanupCamera()` reads `recordings/camera{id}` only.
  - It deletes expired root temp files.
  - It never reads `recordings/camera{id}/pending`.
  - Therefore stale pending partial files have no retention cleanup path.

## Files

- Modify: `backend/services/recordingRetentionPolicy.js`
  - Add partial filename support to safe cleanup classification and age-based deletion policy.
- Modify: `backend/services/recordingCleanupService.js`
  - Add a focused pending partial cleanup pass under `camera{id}/pending`.
- Modify: `backend/services/.module_map.md`
  - Sync the recording cleanup invariant to include pending partial retention cleanup.
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`
  - Cover partial filenames as safe cleanup candidates and retention decisions.
- Modify: `backend/__tests__/recordingCleanupService.test.js`
  - Cover pending partial delete/retain/processing/duplicate-final behavior.

No database migration is needed. No query shape changes are needed. DB I/O remains bounded to one `findExistingFilenames()` call for the current camera cleanup candidate set.

---

### Task 1: Add Failing Retention Policy Coverage

**Files:**
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`

- [ ] **Step 1: Add failing tests for partial filename retention policy**

Insert these assertions into the existing retention policy test file near the temp/final filename tests:

```javascript
it('treats pending partial recording names as safe cleanup filenames', () => {
    expect(isSafeRecordingFilename('20260502_174501.mp4.partial')).toBe(true);
    expect(isSafeRecordingFilename('../20260502_174501.mp4.partial')).toBe(false);
    expect(isSafeRecordingFilename('20260502_174501.partial')).toBe(false);
});

it('allows deleting pending partial files only after retention plus grace', () => {
    const window = computeRetentionWindow({
        retentionHours: 5,
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    const recent = canDeleteRecordingFile({
        filename: '20260502_095800.mp4.partial',
        fileMtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
        retentionWindow: window,
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });
    expect(recent).toMatchObject({
        allowed: false,
        reason: 'retention_not_expired',
    });

    const expired = canDeleteRecordingFile({
        filename: '20260502_020000.mp4.partial',
        fileMtimeMs: Date.parse('2026-05-02T02:01:00.000Z'),
        retentionWindow: window,
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });
    expect(expired).toMatchObject({
        allowed: true,
        reason: 'retention_expired',
    });

    const expiredByFilenameWhenMtimeMissing = canDeleteRecordingFile({
        filename: '20260502_020000.mp4.partial',
        retentionWindow: window,
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });
    expect(expiredByFilenameWhenMtimeMissing).toMatchObject({
        allowed: true,
        reason: 'retention_expired',
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
```

Expected: FAIL because `isSafeRecordingFilename('20260502_174501.mp4.partial')` currently returns `false`, and partial filename timestamps are not parsed for retention age.

- [ ] **Step 3: Implement minimal policy change**

In `backend/services/recordingRetentionPolicy.js`, replace the import:

```javascript
import { isFinalSegmentFilename, isTempSegmentFilename } from './recordingSegmentFilePolicy.js';
```

with:

```javascript
import {
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

Then replace:

```javascript
    const match = safeName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);
```

with:

```javascript
    const match = safeName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4(?:\.partial)?$/);
```

Then replace:

```javascript
    return isFinalSegmentFilename(value) || isTempSegmentFilename(value);
```

with:

```javascript
    return isFinalSegmentFilename(value)
        || isPartialSegmentFilename(value)
        || isTempSegmentFilename(value);
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingRetentionPolicy.js backend/__tests__/recordingRetentionPolicy.test.js
git commit -m "Fix: classify pending partial recordings for retention"
git push
```

---

### Task 2: Add Failing Cleanup Coverage For Pending Partial Files

**Files:**
- Modify: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add failing tests for pending partial cleanup**

Add these tests before the final orphan recovery test:

```javascript
it('deletes expired pending partial files through the shared safe delete path', async () => {
    fsMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('camera7')) return [];
        if (targetPath.endsWith('pending')) return ['20260502_020000.mp4.partial'];
        return [];
    });
    repositoryMock.findExistingFilenames.mockReturnValue([]);
    fsMock.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 2048,
        mtimeMs: Date.parse('2026-05-02T02:01:00.000Z'),
    });

    const service = createService();
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(safeDeleteMock).toHaveBeenCalledWith({
        cameraId: 7,
        filename: '20260502_020000.mp4.partial',
        filePath: join(recordingsBasePath, 'camera7', 'pending', '20260502_020000.mp4.partial'),
        reason: 'pending_partial_retention_expired',
    });
    expect(result.orphanDeleted).toBe(1);
});

it('keeps recent pending partial files until retention expires', async () => {
    fsMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('camera7')) return [];
        if (targetPath.endsWith('pending')) return ['20260502_095800.mp4.partial'];
        return [];
    });
    repositoryMock.findExistingFilenames.mockReturnValue([]);
    fsMock.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 2048,
        mtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
    });

    const service = createService();
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(safeDeleteMock).not.toHaveBeenCalled();
    expect(result.orphanDeleted).toBe(0);
});

it('skips pending partial files currently being processed', async () => {
    fsMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('camera7')) return [];
        if (targetPath.endsWith('pending')) return ['20260502_020000.mp4.partial'];
        return [];
    });
    isProcessingMock.mockReturnValue(true);

    const service = createService();
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(safeDeleteMock).not.toHaveBeenCalled();
    expect(result.processingSkipped).toBe(1);
});

it('deletes stale pending partial files when the final segment already exists in DB', async () => {
    fsMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('camera7')) return [];
        if (targetPath.endsWith('pending')) return ['20260512_000005.mp4.partial'];
        return [];
    });
    repositoryMock.findExistingFilenames.mockReturnValue(['20260512_000005.mp4']);
    fsMock.stat.mockResolvedValue({
        isDirectory: () => false,
        size: 2048,
        mtimeMs: Date.parse('2026-05-02T09:50:00.000Z'),
    });

    const service = createService();
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(safeDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
        filename: '20260512_000005.mp4.partial',
        reason: 'pending_partial_finalized_duplicate',
    }));
    expect(result.orphanDeleted).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: FAIL because `cleanupCamera()` does not scan `camera{id}/pending`.

---

### Task 3: Implement Pending Partial Cleanup In Shared Cleanup Service

**Files:**
- Modify: `backend/services/recordingCleanupService.js`

- [ ] **Step 1: Update imports and constants**

In `backend/services/recordingCleanupService.js`, replace:

```javascript
import {
    isFinalSegmentFilename,
    isTempSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

with:

```javascript
import {
    getPendingRecordingDir,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

Below `TEMP_FILE_MIN_AGE_MS`, add:

```javascript
const FINALIZED_PARTIAL_MIN_AGE_MS = 5 * 60 * 1000;
```

- [ ] **Step 2: Add focused pending partial cleanup helper**

Insert this helper after `cleanupFilesystemOrphans()`:

```javascript
    async function cleanupPendingPartials({ cameraId, retentionWindow, nowMs, result }) {
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

        for (const filename of filenames) {
            const finalFilename = toFinalSegmentFilename(filename);
            if (!finalFilename) {
                result.unsafeSkipped++;
                continue;
            }

            if (
                isFileBeingProcessed?.(cameraId, filename)
                || isFileBeingProcessed?.(cameraId, finalFilename)
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
                && fileAgeMs > FINALIZED_PARTIAL_MIN_AGE_MS;
            if (isFinalizedDuplicate) {
                const deleteResult = await safeDelete({
                    cameraId,
                    filename,
                    filePath,
                    reason: 'pending_partial_finalized_duplicate',
                });

                if (!deleteResult.success) {
                    if (deleteResult.reason === 'unsafe_path') {
                        result.unsafeSkipped++;
                    } else {
                        result.failed++;
                    }
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
                logger.log?.(`[Cleanup] Keeping pending partial recording: camera${cameraId}/${describeRecordingRetentionDecision({
                    filename,
                    decision: deletePolicy,
                })}`);
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename,
                filePath,
                reason: 'pending_partial_retention_expired',
            });

            if (!deleteResult.success) {
                if (deleteResult.reason === 'unsafe_path') {
                    result.unsafeSkipped++;
                } else {
                    result.failed++;
                }
                continue;
            }

            result.orphanDeleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    }
```

- [ ] **Step 3: Wire helper into cleanup flow**

Replace:

```javascript
            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });
```

with:

```javascript
            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });
            await cleanupPendingPartials({ cameraId, retentionWindow, nowMs, result });
```

- [ ] **Step 4: Run cleanup service tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: PASS.

- [ ] **Step 5: Run focused recording tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js recordingService.test.js recordingSegmentFinalizer.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: clean expired pending recording partials"
git push
```

---

### Task 4: Sync Documentation And Maps

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update cleanup invariant**

In `backend/services/.module_map.md`, replace the cleanup invariant bullet:

```markdown
  - Recording cleanup invariant: all destructive cleanup paths must flow through `recordingCleanupService.js` and `recordingRetentionPolicy.js`; final `.mp4` segment files, including corrupt, short, failed-remux, orphaned, or unregistered files from unstable connectivity, must be retained until retention plus grace expires and must receive a recovery/finalizer pass before permanent deletion. Emergency disk cleanup must follow the same invariant.
```

with:

```markdown
  - Recording cleanup invariant: all destructive cleanup paths must flow through `recordingCleanupService.js` and `recordingRetentionPolicy.js`; final `.mp4` segment files and pending `.mp4.partial` recovery files, including corrupt, short, failed-remux, orphaned, or unregistered files from unstable connectivity, must be retained until retention plus grace expires. Final `.mp4` orphans must receive a recovery/finalizer pass before permanent deletion, while pending partials are retried by scanner/finalizer until retention expires. Emergency disk cleanup must follow the same invariant.
```

- [ ] **Step 2: Run map/doc sanity check**

Run:

```bash
git diff -- backend/services/.module_map.md
```

Expected: only the recording cleanup invariant changes.

- [ ] **Step 3: Commit**

```bash
git add backend/services/.module_map.md
git commit -m "Add: document pending partial cleanup invariant"
git push
```

---

### Task 5: Final Verification Gate

**Files:**
- Verify only.

- [ ] **Step 1: Run backend migration and focused tests**

Run:

```bash
cd backend
npm run migrate
npm test -- recordingCleanupService.test.js recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js recordingService.test.js recordingSegmentFinalizer.test.js recordingPlaybackService.test.js recordingSegmentRepository.test.js
```

Expected: migration succeeds and all listed test files pass.

- [ ] **Step 2: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
```

Expected: no uncommitted changes after the task commits. If there are uncommitted changes, inspect with `git diff` and commit only files from this plan.

- [ ] **Step 3: Manual safety review checklist**

Confirm these exact points before reporting complete:

```text
1. safeDelete remains the only destructive file delete path in recordingCleanupService.
2. pending partial cleanup only scans recordings/camera{id}/pending.
3. partial deletion uses retention plus grace unless final DB row already exists and partial is older than 5 minutes.
4. active finalization is protected by isFileBeingProcessed.
5. final orphan recovery behavior is unchanged.
6. emergency disk cleanup behavior is unchanged.
7. no schema or frontend changes were introduced.
```

Expected: all seven points are true.
