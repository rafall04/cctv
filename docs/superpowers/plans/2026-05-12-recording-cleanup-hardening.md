<!--
Purpose: Implementation plan to harden recording segment deletion, recovery, and cleanup indexing.
Caller: Agents executing recording cleanup stabilization work.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recording cleanup/finalizer/repository tests.
MainFuncs: Defines task-by-task TDD plan for cleanup policy unification, temp file classification, emergency recovery, and DB indexes.
SideEffects: None; documentation only.
-->

# Recording Cleanup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording segment deletion server-safe by routing every destructive cleanup path through one recovery-first retention policy with index-backed DB reads.

**Architecture:** Keep `recordingService.js` as the compatibility facade and move cleanup decisions into focused policy/service boundaries. `recordingSegmentFilePolicy.js` owns filename classification, `recordingRetentionPolicy.js` owns age/delete decisions, `recordingCleanupService.js` owns safe deletion orchestration, and `recordingSegmentRepository.js` owns index-friendly SQL.

**Tech Stack:** Node.js 20+, ES modules, Fastify backend, better-sqlite3, Vitest.

---

## Verified Current State

- `recordingService.cleanupTempFiles()` deletes only filenames containing `.temp.mp4` or `.remux.mp4`, while `recordingSegmentFinalizer.getTempRecordingPath()` creates `.tmp.mp4`.
- `recordingService.startBackgroundCleanup()` can delete final unregistered files beyond retention directly, without the `recordingCleanupService` recovery-first orphan path.
- `recordingService.emergencyDiskSpaceCheck()` already calls `cleanupService.emergencyCleanup()` for DB rows, then has an additional filesystem orphan delete loop outside `recordingCleanupService`.
- Existing DB indexes cover `(camera_id, start_time)` and `(camera_id, filename)`, but emergency global oldest scans order by `start_time, id` without a dedicated global index.
- Existing tests already cover retention grace, unsafe paths, bounded cleanup, overlap prevention, and some orphan recovery behavior.

## File Structure

- Modify: `backend/services/recordingSegmentFilePolicy.js`
  - Responsibility: single source of truth for final, partial, temp, and safe cleanup filename classification.
- Modify: `backend/services/recordingRetentionPolicy.js`
  - Responsibility: safe filename and age-based delete decisions using the file policy classifier.
- Modify: `backend/services/recordingCleanupService.js`
  - Responsibility: all retention, orphan, temp, DB-row, and emergency cleanup orchestration.
- Modify: `backend/services/recordingService.js`
  - Responsibility: keep scheduler/facade behavior, delegate cleanup work to `recordingCleanupService`.
- Modify: `backend/services/recordingSegmentRepository.js`
  - Responsibility: bounded SQL access for missing rows, existing filenames, and emergency oldest scans.
- Create: `backend/database/migrations/zz_20260512_add_recording_segments_global_start_index.js`
  - Responsibility: add global index for emergency oldest segment scans.
- Modify: `backend/__tests__/recordingSegmentFilePolicy.test.js`
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`
- Modify: `backend/__tests__/recordingService.test.js`
- Modify: `backend/__tests__/recordingSegmentRepository.test.js`
- Modify: `backend/services/.module_map.md`
  - Responsibility: document cleanup invariant changes if flow changes.

---

### Task 1: Expand Recording File Classification

**Files:**
- Modify: `backend/services/recordingSegmentFilePolicy.js`
- Modify: `backend/__tests__/recordingSegmentFilePolicy.test.js`
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`

- [ ] **Step 1: Write failing file policy tests**

Add expectations to `backend/__tests__/recordingSegmentFilePolicy.test.js` for every temp filename currently found in production paths:

```javascript
it('classifies all supported recording temp segment names', () => {
    expect(isTempSegmentFilename('20260512_000005.tmp.mp4')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.mp4.tmp')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.mp4.remux.mp4')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.mp4.temp.mp4')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.temp.mp4')).toBe(true);
    expect(isTempSegmentFilename('x.temp.mp4')).toBe(false);
    expect(isTempSegmentFilename('../20260512_000005.tmp.mp4')).toBe(false);
});
```

Add expectations to `backend/__tests__/recordingRetentionPolicy.test.js`:

```javascript
it('treats all supported temp recording names as safe cleanup filenames', () => {
    expect(isSafeRecordingFilename('20260502_174501.tmp.mp4')).toBe(true);
    expect(isSafeRecordingFilename('20260502_174501.mp4.tmp')).toBe(true);
    expect(isSafeRecordingFilename('20260502_174501.mp4.remux.mp4')).toBe(true);
    expect(isSafeRecordingFilename('20260502_174501.mp4.temp.mp4')).toBe(true);
    expect(isSafeRecordingFilename('20260502_174501.temp.mp4')).toBe(true);
    expect(isSafeRecordingFilename('x.temp.mp4')).toBe(false);
    expect(isSafeRecordingFilename('20260502_174501.tmp.mp4.exe')).toBe(false);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd backend
npm test -- recordingSegmentFilePolicy.test.js recordingRetentionPolicy.test.js
```

Expected before implementation: at least `.mp4.temp.mp4` or `.temp.mp4` classification fails in `recordingSegmentFilePolicy.test.js`, and `.tmp.mp4` fails in `recordingRetentionPolicy.test.js`.

- [ ] **Step 3: Implement unified temp classifier**

Update `backend/services/recordingSegmentFilePolicy.js` so the temp regex covers all supported temp names:

```javascript
const TEMP_RE = new RegExp(`^${SEGMENT_STAMP}(\\.tmp\\.mp4|\\.mp4\\.tmp|\\.mp4\\.remux\\.mp4|\\.mp4\\.temp\\.mp4|\\.temp\\.mp4)$`);
```

Keep these exports unchanged:

```javascript
export function isTempSegmentFilename(filename) {
    return TEMP_RE.test(filename);
}
```

- [ ] **Step 4: Make retention safety use the file policy classifier**

Update `backend/services/recordingRetentionPolicy.js` imports:

```javascript
import { basename } from 'path';
import { isFinalSegmentFilename, isTempSegmentFilename } from './recordingSegmentFilePolicy.js';
```

Replace local final/temp regex usage in `isSafeRecordingFilename()` with:

```javascript
export function isSafeRecordingFilename(filename) {
    const value = String(filename || '');
    if (value !== basename(value)) {
        return false;
    }

    return isFinalSegmentFilename(value) || isTempSegmentFilename(value);
}
```

Remove unused local `FINAL_SEGMENT_PATTERN` and `TEMP_SEGMENT_PATTERN`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingSegmentFilePolicy.test.js recordingRetentionPolicy.test.js
```

Expected: both test files pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingSegmentFilePolicy.js backend/services/recordingRetentionPolicy.js backend/__tests__/recordingSegmentFilePolicy.test.js backend/__tests__/recordingRetentionPolicy.test.js
git commit -m "Fix: unify recording temp file classification"
```

---

### Task 2: Move Temp Cleanup Into Cleanup Service

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Write failing cleanup service tests**

Add to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('deletes expired temp files through the shared safe delete path', async () => {
    fsMock.readdir.mockResolvedValueOnce(['20260502_095800.tmp.mp4']);
    repositoryMock.findExistingFilenames.mockReturnValueOnce([]);
    fsMock.stat.mockResolvedValueOnce({
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
        filename: '20260502_095800.tmp.mp4',
        reason: 'temp_file_expired',
    }));
    expect(result.orphanDeleted).toBe(1);
});

it('keeps recent temp files to avoid racing active remux work', async () => {
    fsMock.readdir.mockResolvedValueOnce(['20260502_095800.tmp.mp4']);
    repositoryMock.findExistingFilenames.mockReturnValueOnce([]);
    fsMock.stat.mockResolvedValueOnce({
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
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected before implementation: expired `.tmp.mp4` is not deleted through `recordingCleanupService`.

- [ ] **Step 3: Import temp classifier in cleanup service**

Update import in `backend/services/recordingCleanupService.js`:

```javascript
import {
    isFinalSegmentFilename,
    isTempSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

- [ ] **Step 4: Add temp file age constant and helper**

Add near `NORMAL_DELETE_BATCH_SIZE`:

```javascript
const TEMP_FILE_MIN_AGE_MS = 5 * 60 * 1000;

function canDeleteTempFile({ filename, fileMtimeMs, nowMs }) {
    return isTempSegmentFilename(filename) && (nowMs - fileMtimeMs) > TEMP_FILE_MIN_AGE_MS;
}
```

- [ ] **Step 5: Handle temp files before final orphan recovery**

In `cleanupFilesystemOrphans()`, after `stats` is available and before `canDeleteRecordingFile()`, add:

```javascript
if (canDeleteTempFile({ filename, fileMtimeMs: stats.mtimeMs, nowMs })) {
    const deleteResult = await safeDelete({
        cameraId,
        filename,
        filePath,
        reason: 'temp_file_expired',
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

if (isTempSegmentFilename(filename)) {
    logger.log?.(`[Cleanup] Keeping recent temp recording: camera${cameraId}/${filename}`);
    continue;
}
```

- [ ] **Step 6: Replace `recordingService.cleanupTempFiles()` body with delegation**

In `backend/services/recordingService.js`, keep the method name for compatibility but make it call `cleanupOldSegments()` per camera directory:

```javascript
async cleanupTempFiles() {
    try {
        console.log('[Cleanup] Delegating temp cleanup to shared recording cleanup service...');
        try { await fsPromises.access(RECORDINGS_BASE_PATH); } catch { return; }

        const cameraDirs = await fsPromises.readdir(RECORDINGS_BASE_PATH);
        for (const cameraDir of cameraDirs) {
            const cameraIdMatch = cameraDir.match(/^camera(\d+)$/);
            if (!cameraIdMatch) continue;
            await this.cleanupOldSegments(parseInt(cameraIdMatch[1], 10));
        }
    } catch (error) {
        console.error('[Cleanup] Error cleaning temp files:', error);
    }
}
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingService.test.js
```

Expected: both test files pass.

- [ ] **Step 8: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/services/recordingService.js backend/__tests__/recordingCleanupService.test.js backend/__tests__/recordingService.test.js
git commit -m "Fix: route recording temp cleanup through shared policy"
```

---

### Task 3: Make Background Cleanup Recovery-First

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Write failing background cleanup test**

Add a test to `backend/__tests__/recordingService.test.js` that starts background cleanup with controlled scheduler callbacks. The test must prove a beyond-retention final orphan calls `onSegmentCreated()` instead of `deleteRecordingFileSafely()` directly.

Use this test shape:

```javascript
it('background cleanup requeues final orphans for recovery before deletion', async () => {
    vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
    const { recordingService } = await import('../services/recordingService.js');
    const onSegmentSpy = vi.spyOn(recordingService, 'onSegmentCreated').mockImplementation(() => {});

    const scheduled = [];
    const scheduleTimeout = (callback) => {
        scheduled.push(callback);
        return scheduled.length;
    };

    queryOneMock.mockReturnValue({ recording_duration_hours: 1 });
    queryMock.mockReturnValue([]);
    fsPromisesMock.access.mockResolvedValue(undefined);
    fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
        const text = String(targetPath);
        if (text.endsWith('recordings')) return ['camera3'];
        if (text.endsWith('camera3')) return ['20260502_070000.mp4'];
        return [];
    });
    fsPromisesMock.stat.mockResolvedValue({
        isDirectory: () => true,
        size: 4096,
        mtimeMs: Date.parse('2026-05-02T07:00:00.000Z'),
    });

    recordingService.startBackgroundCleanup(scheduleTimeout);
    await scheduled[0]();
    await scheduled[1]();

    expect(onSegmentSpy).toHaveBeenCalledWith(3, '20260502_070000.mp4');
    expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_070000.mp4'));
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "background cleanup requeues final orphans"
```

Expected before implementation: direct unlink path is reached instead of recovery.

- [ ] **Step 3: Change background cleanup process path**

In `startBackgroundCleanup()`, replace the `file.beyondRetention` branch body with:

```javascript
console.log(`[BGCleanup] Requeueing old unregistered final file for recovery before deletion: camera${file.cameraId}/${file.filename}`);
this.onSegmentCreated(file.cameraId, file.filename);
```

Do not call `deleteRecordingFileSafely()` from background cleanup for final `.mp4` files.

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "background cleanup requeues final orphans"
cd backend
npm test -- recordingService.test.js
```

Expected: targeted test passes, then full recording service test passes.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: requeue background recording orphans before deletion"
```

---

### Task 4: Remove Emergency Filesystem Delete Bypass

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/__tests__/recordingService.test.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Write failing emergency orphan recovery test**

Add to `backend/__tests__/recordingService.test.js`:

```javascript
it('emergency disk cleanup does not directly delete filesystem final orphans', async () => {
    vi.setSystemTime(Date.parse('2026-05-02T10:00:00.000Z'));
    execMock[promisify.custom] = vi.fn(async () => ({ stdout: '100\n', stderr: '' }));
    const { recordingService } = await import('../services/recordingService.js');
    const onSegmentSpy = vi.spyOn(recordingService, 'onSegmentCreated').mockImplementation(() => {});

    queryMock.mockReturnValue([]);
    queryOneMock.mockReturnValue({ recording_duration_hours: 1 });
    fsPromisesMock.access.mockResolvedValue(undefined);
    fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
        const text = String(targetPath);
        if (text.endsWith('recordings')) return ['camera7'];
        if (text.endsWith('camera7')) return ['20260502_070000.mp4'];
        return [];
    });
    fsPromisesMock.stat.mockResolvedValue({
        isDirectory: () => true,
        mtimeMs: Date.parse('2026-05-02T07:00:00.000Z'),
        size: 4096,
    });

    await recordingService.emergencyDiskSpaceCheck();

    expect(onSegmentSpy).toHaveBeenCalledWith(7, '20260502_070000.mp4');
    expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_070000.mp4'));
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "emergency disk cleanup does not directly delete filesystem final orphans"
```

Expected before implementation: direct unlink can happen in the emergency filesystem loop.

- [ ] **Step 3: Replace emergency filesystem loop behavior**

In `recordingService.emergencyDiskSpaceCheck()`, remove the direct orphan delete logic for final `.mp4` files. For files that pass retention but are final segments, call:

```javascript
this.onSegmentCreated(cameraId, file.name);
```

Keep direct delete only for temp files that pass `isTempSegmentFilename(file.name)` through a new cleanup service method, or avoid direct temp handling in this method and rely on scheduled cleanup.

- [ ] **Step 4: Prefer cleanup service for emergency filesystem orphans**

If direct filesystem emergency orphan handling remains, move it to `recordingCleanupService` as a method named `recoverExpiredFilesystemOrphans()` with injected `onRecoverOrphan`; otherwise delete the extra loop and rely on scheduled `cleanupCamera()` plus DB emergency cleanup.

Implementation must preserve this invariant:

```javascript
// Final .mp4 filesystem orphans are never directly deleted by recordingService.
// They are requeued through onSegmentCreated/finalizer or handled by recordingCleanupService cleanupCamera().
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingCleanupService.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingService.js backend/services/recordingCleanupService.js backend/__tests__/recordingService.test.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: prevent emergency cleanup from bypassing recording recovery"
```

---

### Task 5: Add Emergency Cleanup DB Index

**Files:**
- Create: `backend/database/migrations/zz_20260512_add_recording_segments_global_start_index.js`
- Modify: `backend/__tests__/recordingSegmentRepository.test.js`

- [ ] **Step 1: Write repository SQL expectation test**

In `backend/__tests__/recordingSegmentRepository.test.js`, ensure the emergency scan query remains ordered by `start_time ASC, id ASC` and uses bounded limits:

```javascript
it('fetches global oldest emergency cleanup candidates with stable cursor order', () => {
    queryMock.mockReturnValueOnce([]);

    recordingSegmentRepository.findOldestSegmentsForEmergency({
        afterStartTime: '2026-05-02T08:00:00.000Z',
        afterId: 44,
        limit: 200,
    });

    expect(queryMock).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY start_time ASC, id ASC'),
        ['2026-05-02T08:00:00.000Z', '2026-05-02T08:00:00.000Z', 44, 200]
    );
});
```

- [ ] **Step 2: Create migration**

Create `backend/database/migrations/zz_20260512_add_recording_segments_global_start_index.js`:

```javascript
// Purpose: Add global recording segment start-time index for emergency cleanup scans.
// Caller: Backend migration runner during deployment/startup migration.
// Deps: better-sqlite3 database handle and recording_segments table.
// MainFuncs: up().
// SideEffects: Creates idx_recording_segments_start_id when recording_segments exists.

export async function up(db) {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_segments'
    `).get();

    if (!table) {
        console.log('recording_segments table does not exist yet; skipping global start index migration');
        return;
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_segments_start_id
        ON recording_segments(start_time, id)
    `);
    console.log('Created index idx_recording_segments_start_id');
}
```

- [ ] **Step 3: Run focused repository test**

Run:

```bash
cd backend
npm test -- recordingSegmentRepository.test.js
```

Expected: repository tests pass.

- [ ] **Step 4: Run migration**

Run:

```bash
cd backend
npm run migrate
```

Expected: migration completes and logs `Created index idx_recording_segments_start_id` or reports it already exists.

- [ ] **Step 5: Commit**

```bash
git add backend/database/migrations/zz_20260512_add_recording_segments_global_start_index.js backend/__tests__/recordingSegmentRepository.test.js
git commit -m "Add: recording segment emergency cleanup index"
```

---

### Task 6: Sync Recording Service Map And Run Full Backend Gate

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update cleanup invariant docs**

In `backend/services/.module_map.md`, update the recording cleanup invariant section so it explicitly states:

```markdown
  - Recording cleanup invariant: all destructive cleanup paths must flow through `recordingCleanupService.js` and `recordingRetentionPolicy.js`; final `.mp4` segment files, including corrupt, short, failed-remux, orphaned, or unregistered files from unstable connectivity, must be retained until retention plus grace expires and must receive a recovery/finalizer pass before permanent deletion. Emergency disk cleanup must follow the same invariant.
```

- [ ] **Step 2: Run focused recording test suite**

Run:

```bash
cd backend
npm test -- recordingSegmentFilePolicy.test.js recordingRetentionPolicy.test.js recordingCleanupService.test.js recordingService.test.js recordingSegmentFinalizer.test.js recordingSegmentRepository.test.js recordingPlaybackService.test.js
```

Expected: all listed test files pass.

- [ ] **Step 3: Run backend gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: migrations complete successfully and full backend test suite passes.

- [ ] **Step 4: Inspect git status**

Run:

```bash
git status --short
```

Expected: only intended recording cleanup files, migration, tests, and module map are changed.

- [ ] **Step 5: Final commit and push**

If Task 6 changed only docs/map:

```bash
git add backend/services/.module_map.md
git commit -m "Fix: document recording cleanup invariants"
git push
```

If all previous commits are local and not yet pushed:

```bash
git push
```

---

## Plan Self-Review

- Spec coverage: covers temp classifier drift, cleanup service unification, background recovery-first behavior, emergency cleanup recovery-first behavior, DB emergency index, docs sync, focused tests, migration, and full backend gate.
- Placeholder scan: no placeholder red flags or unspecified edge-case steps remain.
- Type consistency: functions referenced already exist or are explicitly introduced: `isTempSegmentFilename`, `isSafeRecordingFilename`, `cleanupCamera`, `emergencyCleanup`, `onSegmentCreated`, and `findOldestSegmentsForEmergency`.
- Scope check: this is one backend subsystem, recording cleanup hardening. Frontend playback and live stream behavior are intentionally out of scope.
