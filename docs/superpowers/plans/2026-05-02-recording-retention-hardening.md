<!--
Purpose: Provide the implementation plan for NVR-style recording retention hardening.
Caller: Superpowers writing-plans handoff after cleanup root-cause analysis.
Deps: backend/services/recordingService.js, recordingCleanupService.js, recordingRetentionPolicy.js, recordingSegmentRepository.js, Vitest.
MainFuncs: Retention-only physical deletion, corrupt segment quarantine policy, emergency cleanup guards, cleanup observability.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Recording Retention Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording cleanup behave like an NVR: no final recording segment is permanently deleted until its configured retention period plus grace has expired, even when the segment is short, corrupt, unregistered, orphaned, or produced during unstable connectivity.

**Architecture:** Keep `recordingService.js` as the facade, but move deletion eligibility into pure retention policy helpers used by normal cleanup, background cleanup, segment failure handling, and emergency disk cleanup. Permanent deletion is allowed only through one guarded path that proves retention expiry; non-expired damaged files are retained or quarantined for later review/retry.

**Tech Stack:** Node.js 20 ES modules, Fastify backend service layer, better-sqlite3 through `connectionPool.js`, FFmpeg/ffprobe, Vitest backend tests.

---

## File Structure

- Modify `backend/services/recordingRetentionPolicy.js`: add NVR retention decisions for final files, orphan files, quarantine files, and emergency cleanup.
- Modify `backend/services/recordingCleanupService.js`: require retention eligibility before any `safeDelete` call, including filesystem orphan cleanup and emergency DB cleanup.
- Modify `backend/services/recordingService.js`: stop immediate permanent deletion/quarantine-as-removal behavior for short/corrupt/failed-remux files before expiry; keep them discoverable or quarantined with retention metadata.
- Modify `backend/services/recordingSegmentRepository.js`: add oldest-expired-only emergency query and keep current broad emergency query only if no longer used.
- Modify `backend/__tests__/recordingRetentionPolicy.test.js`: add pure NVR retention eligibility tests.
- Modify `backend/__tests__/recordingCleanupService.test.js`: add normal, orphan, and emergency cleanup regression tests.
- Modify `backend/__tests__/recordingService.test.js`: add unstable-connection short segment tests proving no permanent delete before expiry.
- Modify `backend/services/.module_map.md`: document the new invariant that cleanup cannot permanently delete final recording files before retention expiry.

---

### Task 1: Define NVR Retention Invariants

**Files:**
- Modify: `backend/services/recordingRetentionPolicy.js`
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`

- [ ] **Step 1: Add failing tests for no-delete-before-expiry**

Append to `backend/__tests__/recordingRetentionPolicy.test.js`:

```javascript
import {
    canDeleteRecordingFile,
    getSegmentAgeMs,
} from '../services/recordingRetentionPolicy.js';

it('does not allow deleting recent final files even when they are orphaned or corrupt', () => {
    const nowMs = Date.parse('2026-05-02T10:00:00.000Z');
    const retentionWindow = computeRetentionWindow({ retentionHours: 5, nowMs });

    const result = canDeleteRecordingFile({
        filename: '20260502_095800.mp4',
        fileMtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
        retentionWindow,
        nowMs,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('retention_not_expired');
});

it('allows deleting final files only after retention plus grace expires', () => {
    const nowMs = Date.parse('2026-05-02T10:00:00.000Z');
    const retentionWindow = computeRetentionWindow({ retentionHours: 1, nowMs });

    const result = canDeleteRecordingFile({
        filename: '20260502_080000.mp4',
        fileMtimeMs: Date.parse('2026-05-02T08:01:00.000Z'),
        retentionWindow,
        nowMs,
    });

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe('retention_expired');
});

it('uses the newest trustworthy timestamp so touched old-name files are not deleted prematurely', () => {
    const nowMs = Date.parse('2026-05-02T10:00:00.000Z');
    const ageMs = getSegmentAgeMs({
        filename: '20260502_080000.mp4',
        startTime: null,
        fileMtimeMs: Date.parse('2026-05-02T09:58:00.000Z'),
        nowMs,
    });

    expect(ageMs).toBe(2 * 60 * 1000);
});
```

- [ ] **Step 2: Run the failing policy tests**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
```

Expected: FAIL because `canDeleteRecordingFile` does not exist and `getSegmentAgeMs` currently treats the oldest timestamp as authoritative.

- [ ] **Step 3: Implement the pure policy**

Update `backend/services/recordingRetentionPolicy.js`:

```javascript
export function getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs = Date.now() }) {
    const filenameTimeMs = parseSegmentFilenameTimeMs(filename);
    const startTimeMs = startTime ? Date.parse(startTime) : NaN;
    const candidates = [filenameTimeMs, startTimeMs, fileMtimeMs]
        .filter((value) => Number.isFinite(value));

    if (candidates.length === 0) {
        return 0;
    }

    const newestTrustworthyTimeMs = Math.max(...candidates);
    return Math.max(0, nowMs - newestTrustworthyTimeMs);
}

export function canDeleteRecordingFile({
    filename,
    startTime = null,
    fileMtimeMs = null,
    retentionWindow,
    nowMs = Date.now(),
}) {
    if (!isSafeRecordingFilename(filename)) {
        return { allowed: false, reason: 'unsafe_filename' };
    }

    const ageMs = getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs });
    if (ageMs <= retentionWindow.retentionWithGraceMs) {
        return { allowed: false, reason: 'retention_not_expired', ageMs };
    }

    return { allowed: true, reason: 'retention_expired', ageMs };
}
```

- [ ] **Step 4: Run policy tests**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingRetentionPolicy.js backend/__tests__/recordingRetentionPolicy.test.js
git commit -m "Fix: add NVR recording retention policy"
git push
```

---

### Task 2: Guard Normal and Orphan Cleanup

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add failing cleanup tests**

Append to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('keeps recent filesystem orphans until retention expires', async () => {
    fsMock.readdir.mockResolvedValueOnce(['20260502_095800.mp4']);
    repositoryMock.listFilenamesByCamera.mockReturnValueOnce([]);
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

it('deletes filesystem orphans only after retention expires', async () => {
    fsMock.readdir.mockResolvedValueOnce(['20260502_020000.mp4']);
    repositoryMock.listFilenamesByCamera.mockReturnValueOnce([]);
    fsMock.stat.mockResolvedValueOnce({
        size: 2048,
        mtimeMs: Date.parse('2026-05-02T02:01:00.000Z'),
    });

    const service = createService();
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(safeDeleteMock).toHaveBeenCalledWith(expect.objectContaining({
        reason: 'filesystem_orphan_retention_expired',
    }));
    expect(result.orphanDeleted).toBe(1);
});
```

- [ ] **Step 2: Run failing cleanup tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: FAIL until cleanup uses `canDeleteRecordingFile`.

- [ ] **Step 3: Implement retention guard in orphan cleanup**

Modify imports in `backend/services/recordingCleanupService.js`:

```javascript
import {
    canDeleteRecordingFile,
    computeRetentionWindow,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';
```

Replace the orphan age branch with:

```javascript
const deletePolicy = canDeleteRecordingFile({
    filename,
    fileMtimeMs: stats.mtimeMs,
    retentionWindow,
    nowMs,
});

if (!deletePolicy.allowed) {
    continue;
}
```

- [ ] **Step 4: Run cleanup tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: protect orphan recordings until retention expiry"
git push
```

---

### Task 3: Make Emergency Cleanup Retention-Aware

**Files:**
- Modify: `backend/services/recordingSegmentRepository.js`
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing emergency DB cleanup test**

Append to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('does not emergency-delete DB segments that are inside retention', async () => {
    repositoryMock.findOldestSegmentsForEmergency = vi.fn().mockReturnValueOnce([
        {
            id: 9,
            camera_id: 7,
            filename: '20260502_095800.mp4',
            start_time: '2026-05-02T09:58:00.000Z',
            file_path: join(recordingsBasePath, 'camera7', '20260502_095800.mp4'),
        },
    ]).mockReturnValueOnce([]);
    fsMock.stat.mockResolvedValue({ size: 4096, mtimeMs: Date.parse('2026-05-02T09:59:00.000Z') });

    const service = createService();
    const result = await service.emergencyCleanup({
        freeBytes: 100,
        targetFreeBytes: 2000,
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        getCameraRetentionHours: () => 5,
    });

    expect(safeDeleteMock).not.toHaveBeenCalled();
    expect(repositoryMock.deleteSegmentById).not.toHaveBeenCalledWith(9);
    expect(result.deleted).toBe(0);
});
```

- [ ] **Step 2: Add failing emergency filesystem test**

Append to `backend/__tests__/recordingService.test.js`:

```javascript
it('does not emergency-delete recent filesystem orphan recordings', async () => {
    const { recordingService } = await import('../services/recordingService.js');
    queryMock.mockReturnValue([]);
    execMock[promisify.custom] = vi.fn(async () => ({ stdout: '100\n', stderr: '' }));
    fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
        if (String(targetPath).endsWith('recordings')) return ['camera7'];
        return ['20260502_095800.mp4'];
    });
    fsPromisesMock.stat.mockResolvedValue({
        isDirectory: () => true,
        mtimeMs: Date.parse('2026-05-02T09:59:00.000Z'),
        size: 4096,
    });

    await recordingService.emergencyDiskSpaceCheck();

    expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('20260502_095800.mp4'));
});
```

- [ ] **Step 3: Run failing emergency tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingService.test.js
```

Expected: FAIL because emergency cleanup currently deletes by oldest rows/files without proving retention expiry.

- [ ] **Step 4: Add retention inputs to emergency cleanup**

Update `backend/services/recordingCleanupService.js` emergency signature:

```javascript
async function emergencyCleanup({
    freeBytes,
    targetFreeBytes,
    batchLimit = 200,
    nowMs = Date.now(),
    getCameraRetentionHours = () => null,
}) {
```

Before `safeDelete` in emergency DB loop:

```javascript
let fileMtimeMs = null;
try {
    const stats = await fs.stat(segment.file_path);
    fileMtimeMs = stats.mtimeMs;
} catch {
    fileMtimeMs = null;
}

const retentionWindow = computeRetentionWindow({
    retentionHours: getCameraRetentionHours(segment.camera_id),
    nowMs,
});
const deletePolicy = canDeleteRecordingFile({
    filename: segment.filename,
    startTime: segment.start_time,
    fileMtimeMs,
    retentionWindow,
    nowMs,
});

if (!deletePolicy.allowed) {
    result.processingSkipped++;
    continue;
}
```

- [ ] **Step 5: Guard emergency filesystem scan in `recordingService.js`**

Import policy helper:

```javascript
import { canDeleteRecordingFile, computeRetentionWindow, isSafeRecordingFilename } from './recordingRetentionPolicy.js';
```

Inside emergency filesystem deletion loop, before `deleteRecordingFileSafely`:

```javascript
const camera = cameraId
    ? queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId])
    : null;
const retentionWindow = computeRetentionWindow({
    retentionHours: camera?.recording_duration_hours,
    nowMs: Date.now(),
});
const deletePolicy = canDeleteRecordingFile({
    filename: file.name,
    fileMtimeMs: file.mtime,
    retentionWindow,
    nowMs: Date.now(),
});

if (!deletePolicy.allowed) {
    continue;
}
```

- [ ] **Step 6: Run emergency tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingService.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/services/recordingService.js backend/services/recordingSegmentRepository.js backend/__tests__/recordingCleanupService.test.js backend/__tests__/recordingService.test.js
git commit -m "Fix: enforce retention during emergency recording cleanup"
git push
```

---

### Task 4: Retain Short and Corrupt Segments Until Expiry

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing unstable-connection test**

Append to `backend/__tests__/recordingService.test.js`:

```javascript
it('keeps short unstable-connection segments until retention expiry', async () => {
    const { join } = await import('path');
    execMock[promisify.custom] = vi.fn(async () => ({ stdout: '0.2\n', stderr: '' }));
    const { recordingService } = await import('../services/recordingService.js');
    const recordingsBasePath = join(process.cwd(), '..', 'recordings');

    queryOneMock.mockImplementation((sql) => {
        if (sql.includes('SELECT fail_count FROM failed_remux_files')) return null;
        if (sql.includes('SELECT recording_duration_hours FROM cameras')) return { recording_duration_hours: 5 };
        return null;
    });

    recordingService.onSegmentCreated(3, '20260502_095800.mp4');
    await vi.advanceTimersByTimeAsync(3000);
    await Promise.resolve();

    expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(join(recordingsBasePath, 'camera3', '20260502_095800.mp4'));
    expect(fsPromisesMock.rename).not.toHaveBeenCalledWith(
        join(recordingsBasePath, 'camera3', '20260502_095800.mp4'),
        expect.stringContaining('.quarantine')
    );
});
```

- [ ] **Step 2: Run failing recording service test**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "keeps short unstable-connection segments"
```

Expected: FAIL because current short segment handling quarantines immediately.

- [ ] **Step 3: Implement retention-aware short segment handling**

In `recordingService.js`, replace the invalid duration branch:

```javascript
if (!ffprobeOutput || isNaN(dur) || dur < 1) {
    console.log(`[Segment] File corrupt or invalid duration (${ffprobeOutput}): ${filename}`);
    incrementFailCount(cameraId, filename);

    const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
    const stats = await fsPromises.stat(filePath).catch(() => null);
    const retentionWindow = computeRetentionWindow({
        retentionHours: camera?.recording_duration_hours,
        nowMs: Date.now(),
    });
    const deletePolicy = canDeleteRecordingFile({
        filename,
        fileMtimeMs: stats?.mtimeMs,
        retentionWindow,
        nowMs: Date.now(),
    });

    if (deletePolicy.allowed) {
        await quarantineRecordingFile(cameraId, filename, filePath, 'invalid_duration_retention_expired');
    } else {
        console.warn(`[Segment] Keeping invalid segment until retention expiry: camera${cameraId}/${filename}`);
    }

    cleanup();
    return;
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "short unstable-connection|quarantines invalid short"
```

Expected: PASS after updating the older quarantine expectation to assert no permanent delete before expiry.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: retain short recording segments until expiry"
git push
```

---

### Task 5: Document Cleanup Invariant and Run Full Recording Gate

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update service map invariant**

Add to `backend/services/.module_map.md` under Recording domain:

```markdown
  - Recording cleanup invariant: final `.mp4` segment files, including corrupt, short, orphaned, or unregistered files from unstable connectivity, must not be permanently deleted until the camera retention window plus grace has expired. Emergency disk cleanup must follow the same invariant.
```

- [ ] **Step 2: Run focused recording gate**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js recordingCleanupService.test.js recordingService.test.js recordingSegmentRepository.test.js recordingPlaybackService.test.js
```

Expected: PASS.

- [ ] **Step 3: Run backend gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit and push**

```bash
git add backend/services/.module_map.md
git commit -m "Add: document recording retention invariant"
git push
```

---

## Rollout Notes

- DB-heavy justification: no schema change is required; cleanup still uses bounded batches and indexed segment lookup paths, so write I/O and lock contention stay low.
- Operational check after deployment: inspect logs for `[Segment] Keeping invalid segment until retention expiry`, `[Cleanup] Camera <id> summary`, and `[DiskCheck] LOW DISK SPACE`.
- Expected behavioral change: playback may still not list invalid/unregistered short files, but the physical files remain on disk until retention expiry for later recovery or manual inspection.
- Recovery follow-up after this plan: add an admin "retained damaged recordings" view only if operators need to inspect/quarantine-download those files.

---

## Self-Review

- Spec coverage: covers normal cleanup, orphan cleanup, emergency cleanup, short/corrupt segment handling, tests, and map documentation.
- Placeholder scan: no TBD/TODO placeholders remain.
- Type consistency: `canDeleteRecordingFile`, `computeRetentionWindow`, and `getSegmentAgeMs` are used consistently across tasks.
