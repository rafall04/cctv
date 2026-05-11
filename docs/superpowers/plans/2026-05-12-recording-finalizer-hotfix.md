# Recording Finalizer Hotfix Implementation Plan

<!--
Purpose: Implementation plan for fixing pending MP4 partials that repeatedly enqueue but never become playback-ready recordings.
Caller: Agentic workers executing the approved recording finalizer hotfix.
Deps: backend/services/recordingSegmentFinalizer.js, backend/services/recordingSegmentFilePolicy.js, backend/__tests__/recordingSegmentFinalizer.test.js.
MainFuncs: Documents root cause, file responsibilities, TDD steps, verification, and rollout order.
SideEffects: Documentation only.
-->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every valid `pending/*.mp4.partial` finalize into a DB-backed playback MP4 within the scanner window, and prevent successful partials from consuming duplicate disk space.

**Architecture:** Keep the current recovery design: FFmpeg writes active files to `pending`, finalizer validates/remuxes/promotes to final MP4, then the DB row becomes visible to playback. The hotfix changes only the finalizer and path policy so temp remux files are valid MP4 outputs, success/failure is visible in PM2 logs, and successful partial sources are removed after final verification.

**Tech Stack:** Node.js ES modules, Vitest, FFmpeg/ffprobe child processes, SQLite repositories.

---

## Confirmed Root Cause

The PM2 log shows repeated cycles:

```text
[Scanner] Found pending segment: 20260512_000005.mp4.partial
[Segment] Enqueue finalization: camera7/20260512_000005.mp4.partial
```

The same files are found again around 60 seconds later with higher age. That means `recordingSegmentFinalizer.finalizeSegment()` is not stuck; it returns/fails, `filesBeingProcessed` is cleared, and scanner retries.

The code-level root cause is in `backend/services/recordingSegmentFilePolicy.js` and `backend/services/recordingSegmentFinalizer.js`: finalizer remuxes to `20260512_000005.mp4.tmp`, but `remuxToTemp()` does not pass `-f mp4`. FFmpeg often infers muxer from the last extension, so `.tmp` can fail as an unknown output format. The failure is then hidden because `finalizeSegment()` records diagnostics but emits no PM2 failure log.

Secondary confirmed bug: on a successful partial finalization, the finalizer promotes the temp file and inserts the DB row, but never deletes the source `.partial`. Scanner then skips that partial forever because `existingFilesSet.has(finalFilename)` is true. This is a disk leak, not the cause of the current "pending never moves" symptom.

## File Responsibilities

- Modify: `backend/services/recordingSegmentFilePolicy.js`
  - Change temp path naming from `filename.mp4.tmp` to `filename.tmp.mp4` so the path itself is MP4-compatible.
  - Update temp filename classifier to recognize `*.tmp.mp4` while preserving legacy cleanup recognition for `*.mp4.tmp`.

- Modify: `backend/services/recordingSegmentFinalizer.js`
  - Add `-f mp4` to remux output as a second guard.
  - Delete `sourcePath` after successful DB upsert only when `sourceType === 'partial'` and `sourcePath !== finalPath`.
  - Log finalizer success and failure with camera ID, filename, duration/reason.
  - Best-effort cleanup temp file on remux/probe failure.

- Modify: `backend/__tests__/recordingSegmentFilePolicy.test.js`
  - Assert temp paths end with `.tmp.mp4`.
  - Assert temp classifier accepts new temp files and legacy `.mp4.tmp`.

- Modify: `backend/__tests__/recordingSegmentFinalizer.test.js`
  - Assert FFmpeg receives `-f mp4`.
  - Assert successful partial finalization deletes the source `.partial`.
  - Assert failed remux keeps the source `.partial`.
  - Assert failed remux attempts to clean temp output.

- Modify: `backend/services/.module_map.md`
  - Update recording finalizer invariant to mention MP4-compatible temp names and successful partial cleanup.

---

### Task 1: Fix Temp Filename Policy

**Files:**
- Modify: `backend/services/recordingSegmentFilePolicy.js`
- Test: `backend/__tests__/recordingSegmentFilePolicy.test.js`

- [ ] **Step 1: Write failing temp path tests**

Add assertions to `backend/__tests__/recordingSegmentFilePolicy.test.js`:

```javascript
import {
    getTempRecordingPath,
    isTempSegmentFilename,
} from '../services/recordingSegmentFilePolicy.js';

it('builds MP4-compatible temp remux filenames', () => {
    expect(getTempRecordingPath('C:\\recordings', 7, '20260512_000005.mp4'))
        .toBe('C:\\recordings\\camera7\\20260512_000005.tmp.mp4');
});

it('recognizes current and legacy temp remux filenames', () => {
    expect(isTempSegmentFilename('20260512_000005.tmp.mp4')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.mp4.tmp')).toBe(true);
    expect(isTempSegmentFilename('20260512_000005.mp4.remux.mp4')).toBe(true);
});
```

- [ ] **Step 2: Run the focused policy test and verify it fails**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFilePolicy.test.js
```

Expected: FAIL because `getTempRecordingPath()` still returns `20260512_000005.mp4.tmp` and `isTempSegmentFilename()` does not recognize `20260512_000005.tmp.mp4`.

- [ ] **Step 3: Implement temp path policy**

In `backend/services/recordingSegmentFilePolicy.js`, replace the temp regex and temp path function with:

```javascript
const TEMP_RE = new RegExp(`^${SEGMENT_STAMP}\\.(tmp\\.mp4|mp4\\.tmp|mp4\\.remux\\.mp4)$`);

export function getTempRecordingPath(basePath, cameraId, finalFilename) {
    const finalName = String(finalFilename || '');
    if (!finalName.endsWith('.mp4')) {
        return `${getFinalRecordingPath(basePath, cameraId, finalName)}.tmp`;
    }
    return getFinalRecordingPath(basePath, cameraId, finalName.replace(/\.mp4$/, '.tmp.mp4'));
}
```

- [ ] **Step 4: Run the focused policy test and verify it passes**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFilePolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingSegmentFilePolicy.js backend/__tests__/recordingSegmentFilePolicy.test.js
git commit -m "Fix: use mp4-compatible recording temp names"
git push
```

---

### Task 2: Make Finalizer Remux Explicit And Observable

**Files:**
- Modify: `backend/services/recordingSegmentFinalizer.js`
- Test: `backend/__tests__/recordingSegmentFinalizer.test.js`

- [ ] **Step 1: Write failing remux command test**

In the existing successful partial test in `backend/__tests__/recordingSegmentFinalizer.test.js`, change the expected temp path to:

```javascript
'C:\\recordings\\camera9\\20260511_211000.tmp.mp4'
```

Add this assertion after the existing `spawnMock` assertion:

```javascript
expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
    '-f',
    'mp4',
    'C:\\recordings\\camera9\\20260511_211000.tmp.mp4',
]));
```

- [ ] **Step 2: Run the finalizer test and verify it fails**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFinalizer.test.js
```

Expected: FAIL because `remuxToTemp()` does not pass `-f mp4`.

- [ ] **Step 3: Add explicit MP4 output and result logs**

In `backend/services/recordingSegmentFinalizer.js`, update `remuxToTemp()` arguments:

```javascript
const ffmpeg = spawn('ffmpeg', [
    '-i', sourcePath,
    '-c', 'copy',
    '-movflags', '+faststart',
    '-fflags', '+genpts',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'mp4',
    '-y',
    tempPath,
]);
```

Add a success log immediately before returning success:

```javascript
console.log(`[RecordingFinalizer] Finalized camera${cameraId}/${finalFilename} duration=${duration}s source=${sourceType}`);
```

Add a failure log inside the `catch` block before writing diagnostics:

```javascript
console.warn(`[RecordingFinalizer] Failed camera${cameraId}/${finalFilename}: ${error.message || 'finalize_failed'}`);
```

- [ ] **Step 4: Run the finalizer test and verify it passes**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFinalizer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingSegmentFinalizer.js backend/__tests__/recordingSegmentFinalizer.test.js
git commit -m "Fix: force recording finalizer mp4 remux"
git push
```

---

### Task 3: Delete Successful Partial Sources Only After Final DB Upsert

**Files:**
- Modify: `backend/services/recordingSegmentFinalizer.js`
- Test: `backend/__tests__/recordingSegmentFinalizer.test.js`

- [ ] **Step 1: Write failing successful cleanup test**

In `backend/__tests__/recordingSegmentFinalizer.test.js`, add this assertion to the successful partial test after the DB assertion:

```javascript
expect(fsPromisesMock.unlink).toHaveBeenCalledWith(
    'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial'
);
```

- [ ] **Step 2: Write failed remux retention test**

Add a new test:

```javascript
it('keeps partial source and removes temp when remux fails', async () => {
    spawnMock.mockImplementation(() => createProcess(1));
    const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
    const finalizer = createRecordingSegmentFinalizer({
        recordingsBasePath: 'C:\\recordings',
        repository,
        diagnosticsRepository: diagnostics,
        stabilityDelayMs: 100,
    });

    const promise = finalizer.finalizeSegment({
        cameraId: 9,
        sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
        filename: '20260511_211000.mp4.partial',
        sourceType: 'partial',
    });
    await vi.advanceTimersByTimeAsync(101);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(repository.upsertSegment).not.toHaveBeenCalled();
    expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(
        'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial'
    );
    expect(fsPromisesMock.unlink).toHaveBeenCalledWith(
        'C:\\recordings\\camera9\\20260511_211000.tmp.mp4'
    );
});
```

- [ ] **Step 3: Run the finalizer test and verify it fails**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFinalizer.test.js
```

Expected: FAIL because successful partial cleanup and temp cleanup are not implemented.

- [ ] **Step 4: Implement safe partial cleanup helpers**

In `backend/services/recordingSegmentFinalizer.js`, add:

```javascript
async function removeFileIfExists(filePath) {
    try {
        await fsPromises.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
}

async function cleanupTempFile(tempPath) {
    try {
        await removeFileIfExists(tempPath);
    } catch (error) {
        console.warn(`[RecordingFinalizer] Failed to cleanup temp file ${tempPath}: ${error.message}`);
    }
}
```

After `diagnosticsRepository.clearDiagnostic(...)`, add:

```javascript
if (sourceType === 'partial' && sourcePath !== finalPath) {
    await removeFileIfExists(sourcePath);
}
```

Inside the `catch` block, before diagnostics upsert, add:

```javascript
await cleanupTempFile(tempPath);
```

- [ ] **Step 5: Run the finalizer test and verify it passes**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFinalizer.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingSegmentFinalizer.js backend/__tests__/recordingSegmentFinalizer.test.js
git commit -m "Fix: remove finalized recording partials"
git push
```

---

### Task 4: Prevent Scanner From Silently Ignoring Leftover Successful Partials

**Files:**
- Modify: `backend/services/recordingService.js`
- Test: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Write failing scanner stale-partial cleanup test**

Add a test to `backend/__tests__/recordingService.test.js`:

```javascript
it('removes stale pending partial when final segment already exists in DB', async () => {
    const { recordingService } = await import('../services/recordingService.js');
    queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
    queryMock.mockReturnValue([{ filename: '20260512_000005.mp4' }]);
    fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('recordings')) return ['camera8'];
        if (targetPath.endsWith('camera8')) return ['pending'];
        if (targetPath.endsWith('pending')) return ['20260512_000005.mp4.partial'];
        return [];
    });
    fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
        isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
        size: 4096,
        mtimeMs: Date.now() - 900000,
    }));

    const timers = [];
    recordingService.startSegmentScanner((fn, delay) => {
        timers.push({ fn, delay });
        return 1;
    });
    await timers[0].fn();

    expect(fsPromisesMock.unlink).toHaveBeenCalledWith(expect.stringContaining('20260512_000005.mp4.partial'));
    expect(finalizerMock.finalizeSegment).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the recording service test and verify it fails**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingService.test.js
```

Expected: FAIL because scanner currently `continue`s when final filename exists in DB.

- [ ] **Step 3: Implement stale successful partial cleanup**

In `backend/services/recordingService.js`, change the partial scanner branch from:

```javascript
if (!finalFilename || existingFilesSet.has(finalFilename)) continue;
```

to:

```javascript
if (!finalFilename) continue;
if (existingFilesSet.has(finalFilename)) {
    const filePath = join(pendingDir, filename);
    const stats = await fsPromises.stat(filePath);
    const fileAge = Date.now() - stats.mtimeMs;
    if (fileAge > 5 * 60 * 1000) {
        await fsPromises.unlink(filePath);
        console.log(`[Scanner] Removed finalized pending partial: camera${cameraId}/${filename}`);
    }
    continue;
}
```

This is a safety net only. The primary cleanup remains inside finalizer after successful DB upsert.

- [ ] **Step 4: Run the recording service test and verify it passes**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: cleanup stale finalized partials"
git push
```

---

### Task 5: Update Service Map And Run Full Backend Gate

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update recording finalizer invariant**

In `backend/services/.module_map.md`, update the `recordingSegmentFinalizer.js` bullet to:

```markdown
- `recordingSegmentFinalizer.js`: idempotent finalization pipeline for pending/orphan MP4 files; validates duration, remuxes to MP4-compatible temp output, atomically promotes final MP4, upserts DB, removes successful partial sources, and records/logs diagnostics.
```

- [ ] **Step 2: Run focused recording tests**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run recordingSegmentFilePolicy.test.js recordingSegmentFinalizer.test.js recordingService.test.js recordingCleanupService.test.js recordingAssuranceService.test.js
```

Expected: all listed test files PASS.

- [ ] **Step 3: Run full backend test suite**

Run:

```bash
cd backend
npx -y node@20.19.0 node_modules/vitest/vitest.mjs --run
```

Expected: `56 passed` test files and `376+ passed` tests. The exact test count may increase after new tests are added.

- [ ] **Step 4: Commit**

```bash
git add backend/services/.module_map.md
git commit -m "Docs: document recording finalizer cleanup"
git push
```

---

### Task 6: Production Verification After Deploy

**Files:**
- No code changes.

- [ ] **Step 1: Restart backend under PM2**

Run on server:

```bash
pm2 restart rafnet-cctv-backend
```

Expected: backend starts without migration/runtime errors.

- [ ] **Step 2: Watch finalizer logs for one scanner cycle**

Run on server:

```bash
pm2 logs rafnet-cctv-backend --lines 200
```

Expected after scanner sees old partials:

```text
[Scanner] Found pending segment: ...
[Segment] Enqueue finalization: ...
[RecordingFinalizer] Finalized cameraX/YYYYMMDD_HHMMSS.mp4 duration=...
```

If a file is corrupt, expected:

```text
[RecordingFinalizer] Failed cameraX/YYYYMMDD_HHMMSS.mp4: ...
```

- [ ] **Step 3: Confirm pending folder drains**

Run on server PowerShell or shell equivalent:

```powershell
Get-ChildItem -Path recordings -Recurse -Filter *.partial | Select-Object FullName,Length,LastWriteTime
```

Expected: finished partial files older than 5 minutes either become final DB-backed MP4s or remain only when finalizer logs a clear failure reason.

- [ ] **Step 4: Confirm playback DB row exists for fixed segments**

Run the existing playback page for cameras that had pending files: camera 1, 5, 7, 8, 9, 1168, 1169, 1170.

Expected: valid segments from around `23:57` and `00:00` appear in playback if FFmpeg/ffprobe confirms valid duration.

---

## Self-Review

- Spec coverage: covers the repeated pending retry symptom, remux temp root cause, hidden diagnostics, successful partial disk leak, scanner safety net, tests, docs, and production verification.
- Placeholder scan: no placeholder markers, no vague "add tests" steps, no undefined helper without implementation snippet.
- Type consistency: uses existing `sourceType`, `sourcePath`, `finalPath`, `tempPath`, `fsPromises`, `recordingSegmentFilePolicy`, and Vitest mock names already present in tests.
