<!--
Purpose: Implementation plan for safe, structured recording storage, recovery, playback, and cleanup hardening.
Caller: Agents implementing recording pipeline stabilization after storage/cleanup risk analysis.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recording service tests, SQLite recording indexes.
MainFuncs: Defines TDD tasks, safety invariants, files, verification commands, and rollout gates for recording zero-bug hardening.
SideEffects: None; documentation only.
-->

# Recording Storage Cleanup Zero-Bug Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording storage, recovery, playback reads, and cleanup safe under crashes, disabled cameras, corrupt files, long retention, and low disk pressure without deleting valid recordings.

**Architecture:** Keep `recordingService.js` as the public facade, but move file ownership, path safety, recovery queueing, and cleanup decisions into small services with explicit contracts. FFmpeg writes only pending partials, recovery owns finalization, playback reads only validated DB rows, and cleanup owns every destructive action with quarantine-first behavior.

**Tech Stack:** Node.js 20+, ES modules, Fastify 4, better-sqlite3, Vitest, FFmpeg/ffprobe.

---

## Verification Baseline

- `npm test -- recordingCleanupService.test.js recordingSegmentFinalizer.test.js recordingPlaybackService.test.js recordingService.test.js recordingSegmentRepository.test.js recordingRetentionPolicy.test.js`
- Result before implementation on 2026-05-17: 6 test files passed, 83 tests passed.
- Live local DB has `recording_segments`, `recording_recovery_diagnostics`, and `failed_remux_files`.
- `recording_segments` indexes present: `idx_recording_segments_start_id`, `idx_recording_segments_camera_filename_unique`, `idx_recording_segments_camera_filename`, `idx_recording_segments_camera_start_time`, `idx_segments_camera_time`.
- `recording_recovery_diagnostics` indexes present: `idx_recording_recovery_active_seen`, `idx_recording_recovery_camera_state`, `idx_recording_recovery_active_file`.

## Non-Negotiable Safety Invariants

- No final `.mp4` recording is permanently deleted by new logic before it is either DB-registered, quarantined, or classified terminal after retry and retention checks.
- Cleanup never touches files owned by FFmpeg writing, recovery finalization, or active playback stream validation.
- Playback streams only DB-backed final `.mp4` segments whose resolved path is inside `recordings/camera{id}`.
- Finalizer writes DB rows only after final file exists, probes successfully, and has stable metadata.
- Scanner only discovers files and enqueues recovery; it does not delete final/orphan files.
- Disabled recording stops new FFmpeg work but does not stop recovery of already-created files.
- Emergency cleanup follows the same recovery-first and quarantine-first rules as scheduled cleanup.
- Every destructive operation produces a stable reason string.

## File Structure

- Create: `backend/services/recordingPathSafetyPolicy.js`
  - Pure filename/path/range safety decisions for recording files.
- Create: `backend/services/recordingTimePolicy.js`
  - Pure segment timestamp parsing and retention age helpers using one UTC-first policy.
- Create: `backend/services/recordingFileOperationService.js`
  - Safe delete and quarantine operations; the only file operation service used by cleanup/recovery.
- Create: `backend/services/recordingRecoveryService.js`
  - Bounded recovery queue, per-file ownership locks, finalizer delegation, retry exhaustion decisions.
- Modify: `backend/services/recordingSegmentFilePolicy.js`
  - Keep filename classification, delegate timestamp parsing to `recordingTimePolicy`.
- Modify: `backend/services/recordingRetentionPolicy.js`
  - Use `recordingTimePolicy` and `recordingPathSafetyPolicy`.
- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
  - Persist recovery attempts, terminal state, and quarantine state.
- Modify: `backend/services/recordingSegmentFinalizer.js`
  - Return stable success/failure classifications for recovery queue decisions.
- Modify: `backend/services/recordingCleanupService.js`
  - Route final orphans through recovery result handling; quarantine terminal files.
- Modify: `backend/services/recordingService.js`
  - Replace direct finalizer/delete helpers with recovery and file operation services.
- Modify: `backend/services/recordingSegmentRepository.js`
  - Add window/cursor queries for playback and stream authorization.
- Modify: `backend/services/recordingPlaybackService.js`
  - Remove 1000-oldest stream authorization cap, validate path/window directly.
- Modify: `backend/controllers/recordingController.js`
  - Validate byte ranges before stream creation and return `416` for invalid ranges.
- Modify: `backend/services/.module_map.md`
  - Document recovery queue, file operation service, and quarantine-first invariant.
- Create: `backend/database/migrations/zz_20260517_add_recording_recovery_attempt_fields.js`
  - Add recovery attempt fields to `recording_recovery_diagnostics`.
- Test:
  - `backend/__tests__/recordingPathSafetyPolicy.test.js`
  - `backend/__tests__/recordingTimePolicy.test.js`
  - `backend/__tests__/recordingFileOperationService.test.js`
  - `backend/__tests__/recordingRecoveryService.test.js`
  - Existing recording test files listed above.

---

### Task 1: SDD Skeleton And Approval Gate

**Files:**
- Create: `backend/services/recordingPathSafetyPolicy.js`
- Create: `backend/services/recordingTimePolicy.js`
- Create: `backend/services/recordingFileOperationService.js`
- Create: `backend/services/recordingRecoveryService.js`
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Create service skeletons with Header Docs only**

Create `backend/services/recordingPathSafetyPolicy.js`:

```javascript
// Purpose: Provide pure path, filename, and HTTP byte-range safety decisions for recording files.
// Caller: recording playback, cleanup, recovery, and file operation services.
// Deps: node:path, recordingSegmentFilePolicy.
// MainFuncs: isSafeRecordingFilePath, isPathInside, normalizeRecordingRange.
// SideEffects: None.

export function isPathInside(parentPath, candidatePath) {
    throw new Error('recordingPathSafetyPolicy.isPathInside skeleton pending approval');
}

export function isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename = null }) {
    throw new Error('recordingPathSafetyPolicy.isSafeRecordingFilePath skeleton pending approval');
}

export function normalizeRecordingRange({ rangeHeader, fileSize }) {
    throw new Error('recordingPathSafetyPolicy.normalizeRecordingRange skeleton pending approval');
}
```

Create `backend/services/recordingTimePolicy.js`:

```javascript
// Purpose: Provide one UTC-first timestamp policy for recording filename, DB, and retention age calculations.
// Caller: recordingSegmentFilePolicy, recordingRetentionPolicy, cleanup, recovery, and playback tests.
// Deps: None.
// MainFuncs: parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
// SideEffects: None.

export function parseRecordingFilenameTimestampMs(filename) {
    throw new Error('recordingTimePolicy.parseRecordingFilenameTimestampMs skeleton pending approval');
}

export function parseRecordingDateMs(value) {
    throw new Error('recordingTimePolicy.parseRecordingDateMs skeleton pending approval');
}

export function getRecordingAgeMs({ filename, startTime = null, fileMtimeMs = null, nowMs = Date.now() }) {
    throw new Error('recordingTimePolicy.getRecordingAgeMs skeleton pending approval');
}
```

Create `backend/services/recordingFileOperationService.js`:

```javascript
// Purpose: Centralize safe recording file delete and quarantine operations.
// Caller: recordingCleanupService and recordingRecoveryService.
// Deps: fs promises, node:path, recordingPathSafetyPolicy.
// MainFuncs: createRecordingFileOperationService, deleteFileSafely, quarantineFile.
// SideEffects: Deletes, renames, copies, and quarantines recording files after safety checks.

export function createRecordingFileOperationService() {
    return {
        deleteFileSafely() {
            throw new Error('recordingFileOperationService.deleteFileSafely skeleton pending approval');
        },
        quarantineFile() {
            throw new Error('recordingFileOperationService.quarantineFile skeleton pending approval');
        },
    };
}

export default createRecordingFileOperationService();
```

Create `backend/services/recordingRecoveryService.js`:

```javascript
// Purpose: Own bounded recording file recovery, finalizer delegation, retry limits, and terminal recovery state.
// Caller: recordingService scanners and recordingCleanupService orphan reconciliation.
// Deps: recordingSegmentFinalizer, recordingRecoveryDiagnosticsRepository, recordingFileOperationService.
// MainFuncs: createRecordingRecoveryService, enqueue, recoverNow, drain, isFileOwned.
// SideEffects: Starts bounded FFmpeg/ffprobe recovery work and may quarantine terminal files.

export function createRecordingRecoveryService() {
    return {
        enqueue() {
            throw new Error('recordingRecoveryService.enqueue skeleton pending approval');
        },
        recoverNow() {
            throw new Error('recordingRecoveryService.recoverNow skeleton pending approval');
        },
        drain() {
            throw new Error('recordingRecoveryService.drain skeleton pending approval');
        },
        isFileOwned() {
            throw new Error('recordingRecoveryService.isFileOwned skeleton pending approval');
        },
    };
}

export default createRecordingRecoveryService();
```

- [ ] **Step 2: Update service module map skeleton entries**

Add these lines to `backend/services/.module_map.md` under Recording domain:

```markdown
  - `recordingPathSafetyPolicy.js`: pure path, filename, and byte-range safety decisions shared by playback, cleanup, and recovery.
  - `recordingTimePolicy.js`: UTC-first recording timestamp parsing and age calculation for filename, DB, and retention checks.
  - `recordingFileOperationService.js`: the only safe delete/quarantine side-effect boundary for recording files.
  - `recordingRecoveryService.js`: bounded recovery queue and retry/terminal-state coordinator around `recordingSegmentFinalizer.js`.
```

- [ ] **Step 3: Stop for user approval**

Do not implement internal logic until the user approves the skeleton boundaries. Report only:

```text
Skeleton created for recording safety/recovery services and module map updated. Waiting for approval before internal logic.
```

- [ ] **Step 4: Commit and push skeleton**

Run:

```bash
git status
git add backend/services/recordingPathSafetyPolicy.js backend/services/recordingTimePolicy.js backend/services/recordingFileOperationService.js backend/services/recordingRecoveryService.js backend/services/.module_map.md
git commit -m "Add: recording recovery safety skeletons"
git push
```

Expected: push succeeds to active branch.

---

### Task 2: Path Safety And Range Validation

**Files:**
- Modify: `backend/services/recordingPathSafetyPolicy.js`
- Test: `backend/__tests__/recordingPathSafetyPolicy.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/__tests__/recordingPathSafetyPolicy.test.js`:

```javascript
/**
 * Purpose: Validate recording file path and byte-range safety decisions.
 * Caller: Vitest backend test suite.
 * Deps: recordingPathSafetyPolicy.
 * MainFuncs: isPathInside, isSafeRecordingFilePath, normalizeRecordingRange.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import { join } from 'path';
import {
    isPathInside,
    isSafeRecordingFilePath,
    normalizeRecordingRange,
} from '../services/recordingPathSafetyPolicy.js';

describe('recordingPathSafetyPolicy', () => {
    const base = join(process.cwd(), '..', 'recordings');

    it('accepts only files inside the expected camera directory', () => {
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera7', '20260517_010000.mp4'))).toBe(true);
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera8', '20260517_010000.mp4'))).toBe(false);
        expect(isPathInside(join(base, 'camera7'), join(base, 'camera7'))).toBe(false);
    });

    it('rejects unsafe recording paths and mismatched filenames', () => {
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '20260517_010000.mp4'),
            filename: '20260517_010000.mp4',
        })).toBe(true);
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '..', 'camera8', '20260517_010000.mp4'),
            filename: '20260517_010000.mp4',
        })).toBe(false);
        expect(isSafeRecordingFilePath({
            recordingsBasePath: base,
            cameraId: 7,
            filePath: join(base, 'camera7', '20260517_010000.mp4'),
            filename: '20260517_011000.mp4',
        })).toBe(false);
    });

    it('normalizes valid byte ranges and rejects invalid ones', () => {
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=10-19', fileSize: 100 })).toEqual({
            valid: true,
            partial: true,
            start: 10,
            end: 19,
            chunkSize: 10,
            contentRange: 'bytes 10-19/100',
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=90-', fileSize: 100 })).toMatchObject({
            valid: true,
            start: 90,
            end: 99,
            chunkSize: 10,
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=100-101', fileSize: 100 })).toEqual({
            valid: false,
            statusCode: 416,
            reason: 'range_not_satisfiable',
        });
        expect(normalizeRecordingRange({ rangeHeader: 'bytes=20-10', fileSize: 100 })).toEqual({
            valid: false,
            statusCode: 416,
            reason: 'range_not_satisfiable',
        });
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingPathSafetyPolicy.test.js
```

Expected: fails because skeleton throws.

- [ ] **Step 3: Implement policy**

Replace skeleton in `backend/services/recordingPathSafetyPolicy.js`:

```javascript
// Purpose: Provide pure path, filename, and HTTP byte-range safety decisions for recording files.
// Caller: recording playback, cleanup, recovery, and file operation services.
// Deps: node:path, recordingSegmentFilePolicy.
// MainFuncs: isSafeRecordingFilePath, isPathInside, normalizeRecordingRange.
// SideEffects: None.

import { basename, isAbsolute, join, relative, resolve } from 'path';
import { isSafeRecordingFilename } from './recordingRetentionPolicy.js';

export function isPathInside(parentPath, candidatePath) {
    const parent = resolve(parentPath);
    const candidate = resolve(candidatePath);
    const pathDiff = relative(parent, candidate);
    return Boolean(pathDiff) && !pathDiff.startsWith('..') && !isAbsolute(pathDiff);
}

export function isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename = null }) {
    if (!recordingsBasePath || !cameraId || !filePath) {
        return false;
    }

    const cameraDir = join(recordingsBasePath, `camera${cameraId}`);
    const resolvedPath = resolve(filePath);
    const resolvedFilename = basename(resolvedPath);

    if (!isPathInside(cameraDir, resolvedPath)) {
        return false;
    }

    if (filename && resolvedFilename !== filename) {
        return false;
    }

    return isSafeRecordingFilename(filename || resolvedFilename);
}

export function normalizeRecordingRange({ rangeHeader, fileSize }) {
    const size = Number(fileSize);
    if (!rangeHeader) {
        return {
            valid: true,
            partial: false,
            start: 0,
            end: Math.max(0, size - 1),
            chunkSize: size,
            contentRange: null,
        };
    }

    if (!Number.isFinite(size) || size <= 0) {
        return { valid: false, statusCode: 416, reason: 'range_not_satisfiable' };
    }

    const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
    if (!match) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    const [, rawStart, rawEnd] = match;
    if (!rawStart && !rawEnd) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    let start = rawStart ? Number.parseInt(rawStart, 10) : size - Number.parseInt(rawEnd, 10);
    let end = rawEnd && rawStart ? Number.parseInt(rawEnd, 10) : size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end)) {
        return { valid: false, statusCode: 416, reason: 'invalid_range_header' };
    }

    start = Math.max(0, start);
    end = Math.min(size - 1, end);

    if (start > end || start >= size) {
        return { valid: false, statusCode: 416, reason: 'range_not_satisfiable' };
    }

    return {
        valid: true,
        partial: true,
        start,
        end,
        chunkSize: end - start + 1,
        contentRange: `bytes ${start}-${end}/${size}`,
    };
}
```

- [ ] **Step 4: Run passing test**

Run:

```bash
cd backend
npm test -- recordingPathSafetyPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status
git add backend/services/recordingPathSafetyPolicy.js backend/__tests__/recordingPathSafetyPolicy.test.js
git commit -m "Add: recording path safety policy"
git push
```

---

### Task 3: One Timestamp Policy

**Files:**
- Modify: `backend/services/recordingTimePolicy.js`
- Modify: `backend/services/recordingSegmentFilePolicy.js`
- Modify: `backend/services/recordingRetentionPolicy.js`
- Test: `backend/__tests__/recordingTimePolicy.test.js`
- Test: `backend/__tests__/recordingSegmentFilePolicy.test.js`
- Test: `backend/__tests__/recordingRetentionPolicy.test.js`

- [ ] **Step 1: Write failing timestamp policy tests**

Create `backend/__tests__/recordingTimePolicy.test.js`:

```javascript
/**
 * Purpose: Validate one UTC-first recording timestamp and age policy.
 * Caller: Vitest backend test suite.
 * Deps: recordingTimePolicy.
 * MainFuncs: parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    getRecordingAgeMs,
    parseRecordingDateMs,
    parseRecordingFilenameTimestampMs,
} from '../services/recordingTimePolicy.js';

describe('recordingTimePolicy', () => {
    it('parses segment filenames as UTC timestamps', () => {
        expect(parseRecordingFilenameTimestampMs('20260517_010203.mp4')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingFilenameTimestampMs('20260517_010203.mp4.partial')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingFilenameTimestampMs('../20260517_010203.mp4')).toBe(null);
    });

    it('parses ISO and SQL timestamps deterministically', () => {
        expect(parseRecordingDateMs('2026-05-17T01:02:03.000Z')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingDateMs('2026-05-17 01:02:03')).toBe(Date.UTC(2026, 4, 17, 1, 2, 3));
        expect(parseRecordingDateMs(null)).toBe(null);
    });

    it('uses newest trustworthy timestamp to avoid premature deletion', () => {
        const nowMs = Date.UTC(2026, 4, 17, 2, 0, 0);
        const ageMs = getRecordingAgeMs({
            filename: '20260517_000000.mp4',
            startTime: '2026-05-17T00:00:00.000Z',
            fileMtimeMs: Date.UTC(2026, 4, 17, 1, 59, 0),
            nowMs,
        });
        expect(ageMs).toBe(60 * 1000);
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingTimePolicy.test.js
```

Expected: fails because skeleton throws.

- [ ] **Step 3: Implement timestamp policy**

Replace skeleton in `backend/services/recordingTimePolicy.js`:

```javascript
// Purpose: Provide one UTC-first timestamp policy for recording filename, DB, and retention age calculations.
// Caller: recordingSegmentFilePolicy, recordingRetentionPolicy, cleanup, recovery, and playback tests.
// Deps: node:path.
// MainFuncs: parseRecordingFilenameTimestampMs, parseRecordingDateMs, getRecordingAgeMs.
// SideEffects: None.

import { basename } from 'path';

const RECORDING_STAMP_RE = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4(?:\.partial)?$/;

export function parseRecordingFilenameTimestampMs(filename) {
    const safeName = basename(String(filename || ''));
    if (safeName !== String(filename || '')) {
        return null;
    }

    const match = safeName.match(RECORDING_STAMP_RE);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match.map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function parseRecordingDateMs(value) {
    if (!value) {
        return null;
    }

    const text = String(value);
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)
        ? `${text.replace(' ', 'T')}.000Z`
        : text;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
}

export function getRecordingAgeMs({ filename, startTime = null, fileMtimeMs = null, nowMs = Date.now() }) {
    const candidates = [
        parseRecordingFilenameTimestampMs(filename),
        parseRecordingDateMs(startTime),
        Number.isFinite(fileMtimeMs) ? fileMtimeMs : null,
    ].filter((value) => Number.isFinite(value));

    if (candidates.length === 0) {
        return 0;
    }

    return Math.max(0, nowMs - Math.max(...candidates));
}
```

- [ ] **Step 4: Wire file and retention policies**

In `backend/services/recordingSegmentFilePolicy.js`, import and use `parseRecordingFilenameTimestampMs`:

```javascript
import { parseRecordingFilenameTimestampMs } from './recordingTimePolicy.js';
```

In `parseSegmentFilename(filename)`, replace local `new Date(...)` parsing with:

```javascript
    const timestampMs = parseRecordingFilenameTimestampMs(finalFilename);
    if (!Number.isFinite(timestampMs)) {
        return null;
    }
    const timestamp = new Date(timestampMs);
```

In `backend/services/recordingRetentionPolicy.js`, import:

```javascript
import {
    getRecordingAgeMs,
    parseRecordingFilenameTimestampMs,
    parseRecordingDateMs,
} from './recordingTimePolicy.js';
```

Then make these wrappers preserve existing public API:

```javascript
export function parseSegmentFilenameTimeMs(filename) {
    return parseRecordingFilenameTimestampMs(filename);
}

export function getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs = Date.now() }) {
    return getRecordingAgeMs({ filename, startTime, fileMtimeMs, nowMs });
}

export function isExpiredByRetention(startTime, retentionWindow) {
    const startMs = parseRecordingDateMs(startTime);
    return Number.isFinite(startMs) && startMs < retentionWindow.cutoffMs;
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingTimePolicy.test.js recordingSegmentFilePolicy.test.js recordingRetentionPolicy.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit and push**

Run:

```bash
git status
git add backend/services/recordingTimePolicy.js backend/services/recordingSegmentFilePolicy.js backend/services/recordingRetentionPolicy.js backend/__tests__/recordingTimePolicy.test.js backend/__tests__/recordingSegmentFilePolicy.test.js backend/__tests__/recordingRetentionPolicy.test.js
git commit -m "Fix: unify recording timestamp policy"
git push
```

---

### Task 4: Safe File Operation Boundary

**Files:**
- Modify: `backend/services/recordingFileOperationService.js`
- Test: `backend/__tests__/recordingFileOperationService.test.js`

- [ ] **Step 1: Write failing file operation tests**

Create `backend/__tests__/recordingFileOperationService.test.js`:

```javascript
/**
 * Purpose: Validate safe recording delete and quarantine side effects.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs promises and recordingFileOperationService.
 * MainFuncs: deleteFileSafely, quarantineFile.
 * SideEffects: Filesystem operations are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'path';

const fsMock = {
    stat: vi.fn(),
    unlink: vi.fn(),
    access: vi.fn(),
    mkdir: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
};

const { createRecordingFileOperationService } = await import('../services/recordingFileOperationService.js');

describe('recordingFileOperationService', () => {
    const recordingsBasePath = join(process.cwd(), '..', 'recordings');

    beforeEach(() => {
        vi.clearAllMocks();
        fsMock.stat.mockResolvedValue({ size: 4096 });
        fsMock.unlink.mockResolvedValue(undefined);
        fsMock.access.mockResolvedValue(undefined);
        fsMock.mkdir.mockResolvedValue(undefined);
        fsMock.rename.mockResolvedValue(undefined);
        fsMock.copyFile.mockResolvedValue(undefined);
    });

    it('deletes only safe recording paths', async () => {
        const service = createRecordingFileOperationService({ fs: fsMock, recordingsBasePath });
        const result = await service.deleteFileSafely({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            reason: 'retention_expired',
        });

        expect(result).toEqual({ success: true, size: 4096 });
        expect(fsMock.unlink).toHaveBeenCalledWith(join(recordingsBasePath, 'camera7', '20260517_010000.mp4'));
    });

    it('refuses unsafe delete paths', async () => {
        const service = createRecordingFileOperationService({ fs: fsMock, recordingsBasePath, logger: { warn: vi.fn(), error: vi.fn() } });
        const result = await service.deleteFileSafely({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera8', '20260517_010000.mp4'),
            reason: 'retention_expired',
        });

        expect(result).toMatchObject({ success: false, skipped: true, reason: 'unsafe_path' });
        expect(fsMock.unlink).not.toHaveBeenCalled();
    });

    it('quarantines safe files before permanent deletion', async () => {
        const service = createRecordingFileOperationService({ fs: fsMock, recordingsBasePath, now: () => 12345 });
        const result = await service.quarantineFile({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            reason: 'terminal_recovery_failed',
        });

        expect(result.success).toBe(true);
        expect(fsMock.mkdir).toHaveBeenCalledWith(join(recordingsBasePath, '.quarantine', 'camera7'), { recursive: true });
        expect(fsMock.rename).toHaveBeenCalledWith(
            join(recordingsBasePath, 'camera7', '20260517_010000.mp4'),
            join(recordingsBasePath, '.quarantine', 'camera7', '12345_terminal_recovery_failed_20260517_010000.mp4')
        );
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingFileOperationService.test.js
```

Expected: fails because skeleton throws.

- [ ] **Step 3: Implement safe operations**

Replace skeleton in `backend/services/recordingFileOperationService.js`:

```javascript
// Purpose: Centralize safe recording file delete and quarantine operations.
// Caller: recordingCleanupService and recordingRecoveryService.
// Deps: fs promises, node:path, recordingPathSafetyPolicy.
// MainFuncs: createRecordingFileOperationService, deleteFileSafely, quarantineFile.
// SideEffects: Deletes, renames, copies, and quarantines recording files after safety checks.

import { promises as defaultFs } from 'fs';
import { basename, join } from 'path';
import { isSafeRecordingFilePath } from './recordingPathSafetyPolicy.js';

const QUARANTINE_DIR_NAME = '.quarantine';

export function createRecordingFileOperationService({
    fs = defaultFs,
    recordingsBasePath,
    logger = console,
    now = Date.now,
} = {}) {
    async function deleteFileSafely({ cameraId, filename, filePath, reason }) {
        if (!isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename })) {
            logger.warn?.(`[Cleanup] Refusing unsafe delete for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
            return { success: false, skipped: true, reason: 'unsafe_path', size: 0 };
        }

        try {
            const stats = await fs.stat(filePath);
            await fs.unlink(filePath);
            return { success: true, size: stats.size };
        } catch (error) {
            if (error.code === 'ENOENT') {
                return { success: true, missing: true, size: 0 };
            }

            logger.error?.(`[Cleanup] Error deleting ${filename || basename(filePath)} (${reason}):`, error.message);
            return { success: false, reason: error.message, size: 0 };
        }
    }

    async function quarantineFile({ cameraId, filename, filePath, reason }) {
        if (!isSafeRecordingFilePath({ recordingsBasePath, cameraId, filePath, filename })) {
            logger.warn?.(`[Segment] Refusing unsafe quarantine for camera${cameraId}/${filename || basename(filePath || '')} (${reason})`);
            return { success: false, skipped: true, reason: 'unsafe_path' };
        }

        try {
            await fs.access(filePath);
        } catch {
            return { success: true, missing: true };
        }

        const quarantineDir = join(recordingsBasePath, QUARANTINE_DIR_NAME, `camera${cameraId}`);
        const safeReason = String(reason || 'unknown').replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);
        const quarantineName = `${now()}_${safeReason}_${filename}`;
        const quarantinePath = join(quarantineDir, quarantineName);

        try {
            await fs.mkdir(quarantineDir, { recursive: true });
            await fs.rename(filePath, quarantinePath);
            logger.warn?.(`[Segment] Quarantined file: camera${cameraId}/${filename} -> ${QUARANTINE_DIR_NAME}/camera${cameraId}/${quarantineName}`);
            return { success: true, path: quarantinePath };
        } catch (error) {
            if (error.code === 'EXDEV') {
                await fs.copyFile(filePath, quarantinePath);
                await fs.unlink(filePath);
                logger.warn?.(`[Segment] Quarantined file with copy fallback: camera${cameraId}/${filename}`);
                return { success: true, path: quarantinePath };
            }

            logger.error?.(`[Segment] Failed to quarantine ${filename}:`, error.message);
            return { success: false, reason: error.message };
        }
    }

    return { deleteFileSafely, quarantineFile };
}

export default createRecordingFileOperationService();
```

- [ ] **Step 4: Run passing test**

Run:

```bash
cd backend
npm test -- recordingFileOperationService.test.js recordingPathSafetyPolicy.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status
git add backend/services/recordingFileOperationService.js backend/__tests__/recordingFileOperationService.test.js
git commit -m "Add: safe recording file operations"
git push
```

---

### Task 5: Recovery Attempts Migration And Repository

**Files:**
- Create: `backend/database/migrations/zz_20260517_add_recording_recovery_attempt_fields.js`
- Modify: `backend/services/recordingRecoveryDiagnosticsRepository.js`
- Test: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`

- [ ] **Step 1: Write failing repository tests**

Add to `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`:

```javascript
it('increments active recovery attempts for one file', () => {
    executeMock.mockReturnValueOnce({ changes: 1 });

    recordingRecoveryDiagnosticsRepository.incrementAttempt({
        cameraId: 7,
        filename: '20260517_010000.mp4',
        filePath: 'C:\\recordings\\camera7\\20260517_010000.mp4',
        reason: 'invalid_duration',
        attemptedAt: '2026-05-17T01:30:00.000Z',
    });

    expect(executeMock).toHaveBeenCalledWith(
        expect.stringContaining('attempt_count = attempt_count + 1'),
        [
            7,
            '20260517_010000.mp4',
            'C:\\recordings\\camera7\\20260517_010000.mp4',
            'retryable_failed',
            'invalid_duration',
            '2026-05-17T01:30:00.000Z',
            '2026-05-17T01:30:00.000Z',
        ]
    );
});

it('marks a file terminal and quarantined', () => {
    executeMock.mockReturnValueOnce({ changes: 1 });

    recordingRecoveryDiagnosticsRepository.markTerminal({
        cameraId: 7,
        filename: '20260517_010000.mp4',
        reason: 'retry_limit_exhausted',
        quarantinedPath: 'C:\\recordings\\.quarantine\\camera7\\x.mp4',
    });

    expect(executeMock).toHaveBeenCalledWith(
        expect.stringContaining('terminal_state = ?'),
        [
            'unrecoverable',
            'retry_limit_exhausted',
            'C:\\recordings\\.quarantine\\camera7\\x.mp4',
            7,
            '20260517_010000.mp4',
        ]
    );
});
```

- [ ] **Step 2: Run repository test and verify failure**

Run:

```bash
cd backend
npm test -- recordingRecoveryDiagnosticsRepository.test.js
```

Expected: fails because methods do not exist.

- [ ] **Step 3: Add migration**

Create `backend/database/migrations/zz_20260517_add_recording_recovery_attempt_fields.js`:

```javascript
// Purpose: Add retry and quarantine fields to recording recovery diagnostics.
// Caller: Backend migration runner after recording_recovery_diagnostics exists.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Adds nullable columns and indexes for recovery attempt tracking.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

function columnExists(table, column) {
    return db.prepare(`PRAGMA table_info(${table})`).all().some((item) => item.name === column);
}

try {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_recovery_diagnostics'
    `).get();

    if (!table) {
        console.log('recording_recovery_diagnostics table does not exist yet; skipping attempt fields migration');
        process.exit(0);
    }

    if (!columnExists('recording_recovery_diagnostics', 'attempt_count')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN attempt_count INTEGER DEFAULT 0');
    }
    if (!columnExists('recording_recovery_diagnostics', 'terminal_state')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN terminal_state TEXT');
    }
    if (!columnExists('recording_recovery_diagnostics', 'quarantined_path')) {
        db.exec('ALTER TABLE recording_recovery_diagnostics ADD COLUMN quarantined_path TEXT');
    }

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_recovery_attempt_state
        ON recording_recovery_diagnostics(active, state, attempt_count);
    `);

    console.log('Added recording recovery attempt fields');
} finally {
    db.close();
}
```

- [ ] **Step 4: Implement repository methods**

Add to `RecordingRecoveryDiagnosticsRepository`:

```javascript
    incrementAttempt({
        cameraId,
        filename,
        filePath,
        reason,
        attemptedAt = new Date().toISOString(),
    }) {
        return execute(
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
    }

    markTerminal({
        cameraId,
        filename,
        reason,
        terminalState = 'unrecoverable',
        quarantinedPath = null,
    }) {
        return execute(
            `UPDATE recording_recovery_diagnostics
            SET
                state = ?,
                reason = ?,
                terminal_state = ?,
                quarantined_path = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE camera_id = ? AND filename = ? AND active = 1`,
            [terminalState, reason, terminalState, quarantinedPath, cameraId, filename]
        );
    }
```

- [ ] **Step 5: Run migration and tests**

Run:

```bash
cd backend
npm run migrate
npm test -- recordingRecoveryDiagnosticsRepository.test.js
```

Expected: migration succeeds and test passes.

- [ ] **Step 6: Commit and push**

Run:

```bash
git status
git add backend/database/migrations/zz_20260517_add_recording_recovery_attempt_fields.js backend/services/recordingRecoveryDiagnosticsRepository.js backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js
git commit -m "Add: recording recovery attempt tracking"
git push
```

DB-heavy justification: attempt fields are row-local updates on indexed `(camera_id, filename, active)` diagnostics rows, avoiding filesystem rescans and N+1 history tables.

---

### Task 6: Bounded Recovery Queue

**Files:**
- Modify: `backend/services/recordingRecoveryService.js`
- Test: `backend/__tests__/recordingRecoveryService.test.js`

- [ ] **Step 1: Write failing queue tests**

Create `backend/__tests__/recordingRecoveryService.test.js`:

```javascript
/**
 * Purpose: Validate bounded, idempotent recording recovery queue behavior.
 * Caller: Vitest backend test suite.
 * Deps: recordingRecoveryService with mocked finalizer, diagnostics, and file operations.
 * MainFuncs: enqueue, recoverNow, drain, isFileOwned.
 * SideEffects: All side effects are mocked.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRecordingRecoveryService } from '../services/recordingRecoveryService.js';

function createService(overrides = {}) {
    return createRecordingRecoveryService({
        finalizer: overrides.finalizer || { finalizeSegment: vi.fn(async () => ({ success: true, finalFilename: '20260517_010000.mp4' })) },
        diagnosticsRepository: overrides.diagnosticsRepository || {
            incrementAttempt: vi.fn(),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        },
        fileOperations: overrides.fileOperations || {
            quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })),
        },
        maxConcurrent: overrides.maxConcurrent ?? 2,
        maxAttempts: overrides.maxAttempts ?? 3,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
}

describe('recordingRecoveryService', () => {
    it('deduplicates recovery for the same camera and final filename', async () => {
        const finalizer = { finalizeSegment: vi.fn(async () => ({ success: true, finalFilename: '20260517_010000.mp4' })) };
        const service = createService({ finalizer });

        const first = service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });
        const second = service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4.partial',
            sourcePath: 'pending-path',
            sourceType: 'partial',
        });

        await Promise.all([first, second]);
        expect(finalizer.finalizeSegment).toHaveBeenCalledTimes(1);
    });

    it('quarantines terminal files after retry exhaustion', async () => {
        const finalizer = { finalizeSegment: vi.fn(async () => ({ success: false, reason: 'invalid_duration', finalFilename: '20260517_010000.mp4' })) };
        const diagnosticsRepository = {
            incrementAttempt: vi.fn(() => ({ changes: 1 })),
            markTerminal: vi.fn(),
            clearDiagnostic: vi.fn(),
        };
        const fileOperations = { quarantineFile: vi.fn(async () => ({ success: true, path: 'quarantine-path' })) };
        const service = createService({ finalizer, diagnosticsRepository, fileOperations, maxAttempts: 1 });

        const result = await service.recoverNow({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            sourcePath: 'final-path',
            sourceType: 'final_orphan',
            attemptCount: 1,
        });

        expect(result).toMatchObject({ success: false, terminal: true, reason: 'invalid_duration' });
        expect(fileOperations.quarantineFile).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            filePath: 'final-path',
            reason: 'terminal_recovery_failed',
        }));
        expect(diagnosticsRepository.markTerminal).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260517_010000.mp4',
            quarantinedPath: 'quarantine-path',
        }));
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js
```

Expected: fails because skeleton throws.

- [ ] **Step 3: Implement recovery service**

Replace skeleton in `backend/services/recordingRecoveryService.js` with a bounded queue implementation:

```javascript
// Purpose: Own bounded recording file recovery, finalizer delegation, retry limits, and terminal recovery state.
// Caller: recordingService scanners and recordingCleanupService orphan reconciliation.
// Deps: recordingSegmentFinalizer, recordingRecoveryDiagnosticsRepository, recordingFileOperationService.
// MainFuncs: createRecordingRecoveryService, enqueue, recoverNow, drain, isFileOwned.
// SideEffects: Starts bounded FFmpeg/ffprobe recovery work and may quarantine terminal files.

import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import recordingFileOperationService from './recordingFileOperationService.js';
import { toFinalSegmentFilename } from './recordingSegmentFilePolicy.js';

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createRecordingRecoveryService({
    finalizer = recordingSegmentFinalizer,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    fileOperations = recordingFileOperationService,
    maxConcurrent = 3,
    maxAttempts = 3,
    logger = console,
} = {}) {
    const queue = [];
    const inFlight = new Map();
    let activeCount = 0;

    function keyFor(input) {
        return `${input.cameraId}:${toFinalSegmentFilename(input.filename) || input.filename}`;
    }

    function isFileOwned(cameraId, filename) {
        return inFlight.has(`${cameraId}:${toFinalSegmentFilename(filename) || filename}`);
    }

    async function recoverNow(input) {
        const key = keyFor(input);
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }

        const promise = (async () => {
            const finalFilename = toFinalSegmentFilename(input.filename) || input.filename;
            const result = await finalizer.finalizeSegment(input);
            if (result.success) {
                diagnosticsRepository.clearDiagnostic?.({ cameraId: input.cameraId, filename: finalFilename });
                return result;
            }

            diagnosticsRepository.incrementAttempt?.({
                cameraId: input.cameraId,
                filename: finalFilename,
                filePath: input.sourcePath,
                reason: result.reason || 'recovery_failed',
            });

            const nextAttemptCount = Number(input.attemptCount || 0) + 1;
            if (nextAttemptCount < maxAttempts) {
                return { ...result, terminal: false, attemptCount: nextAttemptCount };
            }

            const quarantineResult = await fileOperations.quarantineFile({
                cameraId: input.cameraId,
                filename: finalFilename,
                filePath: input.sourcePath,
                reason: 'terminal_recovery_failed',
            });

            diagnosticsRepository.markTerminal?.({
                cameraId: input.cameraId,
                filename: finalFilename,
                reason: result.reason || 'retry_limit_exhausted',
                quarantinedPath: quarantineResult.path || null,
            });

            return {
                ...result,
                terminal: true,
                attemptCount: nextAttemptCount,
                quarantine: quarantineResult,
            };
        })().finally(() => {
            inFlight.delete(key);
        });

        inFlight.set(key, promise);
        return promise;
    }

    function pump() {
        while (activeCount < maxConcurrent && queue.length > 0) {
            const input = queue.shift();
            activeCount += 1;
            recoverNow(input)
                .catch((error) => {
                    logger.error?.('[RecordingRecovery] Recovery queue item failed:', error.message);
                })
                .finally(() => {
                    activeCount -= 1;
                    pump();
                });
        }
    }

    function enqueue(input) {
        if (isFileOwned(input.cameraId, input.filename)) {
            return { queued: false, reason: 'already_owned' };
        }
        queue.push(input);
        pump();
        return { queued: true };
    }

    async function drain(timeoutMs = 30000) {
        const startedAt = Date.now();
        while ((queue.length > 0 || inFlight.size > 0 || activeCount > 0) && Date.now() - startedAt < timeoutMs) {
            await sleep(25);
        }
        return {
            drained: queue.length === 0 && inFlight.size === 0 && activeCount === 0,
            pending: queue.length + inFlight.size,
        };
    }

    return { enqueue, recoverNow, drain, isFileOwned };
}

export default createRecordingRecoveryService();
```

- [ ] **Step 4: Run passing tests**

Run:

```bash
cd backend
npm test -- recordingRecoveryService.test.js recordingSegmentFinalizer.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status
git add backend/services/recordingRecoveryService.js backend/__tests__/recordingRecoveryService.test.js
git commit -m "Add: bounded recording recovery queue"
git push
```

---

### Task 7: Wire Recovery Into Scanner And Cleanup

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/services/recordingCleanupService.js`
- Test: `backend/__tests__/recordingService.test.js`
- Test: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Write failing cleanup tests**

Add to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('quarantines expired final orphan only after recovery returns terminal failure', async () => {
    const onRecoverOrphan = vi.fn(async () => ({
        success: false,
        terminal: true,
        reason: 'invalid_duration',
        quarantine: { success: true, path: 'quarantine-path' },
    }));
    fsMock.readdir.mockResolvedValueOnce(['20260502_020000.mp4']);
    repositoryMock.findExistingFilenames.mockReturnValueOnce([]);
    fsMock.stat.mockResolvedValueOnce({
        isDirectory: () => false,
        size: 2048,
        mtimeMs: Date.parse('2026-05-02T02:01:00.000Z'),
    });

    const service = createRecordingCleanupService({
        repository: repositoryMock,
        fs: fsMock,
        recordingsBasePath,
        safeDelete: safeDeleteMock,
        isFileBeingProcessed: isProcessingMock,
        onRecoverOrphan,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
    const result = await service.cleanupCamera({
        cameraId: 7,
        camera: { recording_duration_hours: 5, name: 'Camera 7' },
        nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
    });

    expect(onRecoverOrphan).toHaveBeenCalledWith(expect.objectContaining({
        cameraId: 7,
        filename: '20260502_020000.mp4',
        sourceType: 'final_orphan',
    }));
    expect(safeDeleteMock).not.toHaveBeenCalledWith(expect.objectContaining({
        filename: '20260502_020000.mp4',
    }));
    expect(result.orphanDeleted).toBe(0);
});
```

Add to `backend/__tests__/recordingService.test.js`:

```javascript
it('scanner recovers disabled camera directories with existing pending files', async () => {
    finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
    const { recordingService } = await import('../services/recordingService.js');
    queryOneMock.mockReturnValue({ id: 8, enable_recording: 0 });
    queryMock.mockReturnValue([]);
    fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
        if (targetPath.endsWith('recordings')) return ['camera8'];
        if (targetPath.endsWith('camera8')) return ['pending'];
        if (targetPath.endsWith('pending')) return ['20260517_010000.mp4.partial'];
        return [];
    });
    fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
        isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
        size: 4096,
        mtimeMs: Date.now() - 120000,
    }));
    const segmentSpy = vi.spyOn(recordingService, 'onSegmentCreated');

    const runs = [];
    let scheduled = false;
    recordingService.startSegmentScanner((callback) => {
        if (!scheduled) {
            scheduled = true;
            runs.push(callback());
        }
        return 1;
    });
    await Promise.all(runs);

    expect(segmentSpy).toHaveBeenCalledWith(8, '20260517_010000.mp4.partial');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingService.test.js
```

Expected: scanner disabled-camera test fails until enabled-recording guard is relaxed; cleanup terminal handling fails until terminal result is handled.

- [ ] **Step 3: Wire recovery service**

In `backend/services/recordingService.js`, import:

```javascript
import recordingRecoveryService from './recordingRecoveryService.js';
import recordingFileOperationService, { createRecordingFileOperationService } from './recordingFileOperationService.js';
```

Replace `onRecoverOrphan` finalizer call in cleanup service creation:

```javascript
    onRecoverOrphan: ({ cameraId, filename, filePath, sourceType }) => recordingRecoveryService.recoverNow({
        cameraId,
        filename,
        sourcePath: filePath,
        sourceType,
    }),
```

Replace `recordingSegmentFinalizer.finalizeSegment` call in `onSegmentCreated`:

```javascript
        recordingRecoveryService.recoverNow({
            cameraId,
            sourcePath,
            filename,
            sourceType,
        }).finally(() => {
            filesBeingProcessed.delete(fileKey);
        });
```

In `shutdown()`, drain recovery before finalizer:

```javascript
        const recoveryDrainResult = await recordingRecoveryService.drain(30000);
        if (!recoveryDrainResult.drained) {
            console.warn(`[Shutdown] Recording recovery drain timed out with ${recoveryDrainResult.pending} pending file(s)`);
        }
        const drainResult = await recordingSegmentFinalizer.drain(30000);
```

- [ ] **Step 4: Let scanner recover disabled camera files**

In `startSegmentScanner`, replace:

```javascript
                    const camera = queryOne('SELECT id, enable_recording FROM cameras WHERE id = ?', [cameraId]);
                    if (!camera || !camera.enable_recording) continue;
```

with:

```javascript
                    const camera = queryOne('SELECT id FROM cameras WHERE id = ?', [cameraId]);
                    if (!camera) continue;
```

- [ ] **Step 5: Keep cleanup recovery-first**

In `backend/services/recordingCleanupService.js`, keep final-orphan recovery result and never direct-delete final orphan:

```javascript
            if (isFinalSegmentFilename(filename) && onRecoverOrphan) {
                const recoveryResult = await onRecoverOrphan({
                    cameraId,
                    filename,
                    filePath,
                    sourceType: 'final_orphan',
                });
                if (recoveryResult?.success) {
                    logger.log?.(`[Cleanup] Recovered final orphan before cleanup: camera${cameraId}/${filename}`);
                } else if (recoveryResult?.terminal) {
                    logger.warn?.(`[Cleanup] Terminal recovery handled for final orphan: camera${cameraId}/${filename}`);
                } else {
                    logger.log?.(`[Cleanup] Requeued final orphan for recovery before delete: camera${cameraId}/${filename}`);
                }
                continue;
            }
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingRecoveryService.test.js recordingService.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit and push**

Run:

```bash
git status
git add backend/services/recordingService.js backend/services/recordingCleanupService.js backend/__tests__/recordingService.test.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: route recording recovery through bounded queue"
git push
```

---

### Task 8: Playback Path Safety And Window Queries

**Files:**
- Modify: `backend/services/recordingSegmentRepository.js`
- Modify: `backend/services/recordingPlaybackService.js`
- Modify: `backend/controllers/recordingController.js`
- Test: `backend/__tests__/recordingSegmentRepository.test.js`
- Test: `backend/__tests__/recordingPlaybackService.test.js`
- Test: `backend/__tests__/recordingController.test.js`

- [ ] **Step 1: Add repository tests for direct window authorization**

Add to `backend/__tests__/recordingSegmentRepository.test.js`:

```javascript
it('checks one filename inside a playback window without loading all segments', () => {
    queryOneMock.mockReturnValueOnce({ id: 9, filename: '20260517_010000.mp4' });

    const result = recordingSegmentRepository.findSegmentInWindow({
        cameraId: 7,
        filename: '20260517_010000.mp4',
        startAfterIso: '2026-05-16T01:00:00.000Z',
    });

    expect(result.id).toBe(9);
    expect(queryOneMock).toHaveBeenCalledWith(
        expect.stringContaining('AND start_time >= ?'),
        [7, '20260517_010000.mp4', '2026-05-16T01:00:00.000Z']
    );
});
```

- [ ] **Step 2: Implement repository method**

Add to `RecordingSegmentRepository`:

```javascript
    findSegmentInWindow({ cameraId, filename, startAfterIso = null }) {
        if (!startAfterIso) {
            return this.findSegmentByFilename({ cameraId, filename });
        }

        return queryOne(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND filename = ? AND start_time >= ?`,
            [cameraId, filename, startAfterIso]
        );
    }
```

- [ ] **Step 3: Add playback service tests**

Add to `backend/__tests__/recordingPlaybackService.test.js`:

```javascript
it('rejects stream segment when DB path escapes camera recording directory', () => {
    queryOneMock
        .mockReturnValueOnce({
            id: 9,
            name: 'CCTV TAMAN',
            public_playback_mode: 'inherit',
            public_playback_preview_minutes: null,
        })
        .mockReturnValueOnce({ value: '628111111111' })
        .mockReturnValueOnce({
            id: 2,
            filename: '20260517_010000.mp4',
            start_time: '2026-05-17T01:00:00.000Z',
            end_time: '2026-05-17T01:10:00.000Z',
            duration: 600,
            file_path: 'C:\\escape\\20260517_010000.mp4',
            file_size: 100,
            created_at: '2026-05-17T01:00:00.000Z',
        });
    queryMock.mockReturnValueOnce([{ id: 2, filename: '20260517_010000.mp4', start_time: '2026-05-17T01:00:00.000Z' }]);

    expect(() => recordingPlaybackService.getStreamSegment(9, '20260517_010000.mp4', { query: {} }))
        .toThrow('Segment file path is not safe');
});
```

- [ ] **Step 4: Add controller invalid range test**

Create `backend/__tests__/recordingController.test.js`:

```javascript
/**
 * Purpose: Validate recording HTTP controller stream range handling.
 * Caller: Vitest backend test suite.
 * Deps: mocked recordingPlaybackService and recordingController.
 * MainFuncs: streamSegment.
 * SideEffects: None; stream creation is mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStreamSegmentMock = vi.fn();
const createReadStreamMock = vi.fn();

vi.mock('../services/recordingPlaybackService.js', () => ({
    default: {
        getStreamSegment: getStreamSegmentMock,
    },
}));

vi.mock('fs', () => ({
    createReadStream: createReadStreamMock,
}));

const { streamSegment } = await import('../controllers/recordingController.js');

function createReply() {
    const reply = {
        statusCode: null,
        headers: {},
        payload: null,
        header: vi.fn(function setHeader(name, value) {
            this.headers[name] = value;
            return this;
        }),
        code: vi.fn(function setCode(statusCode) {
            this.statusCode = statusCode;
            return this;
        }),
        send: vi.fn(function send(payload) {
            this.payload = payload;
            return this;
        }),
    };
    return reply;
}

describe('recordingController', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getStreamSegmentMock.mockReturnValue({
            segment: { file_path: 'C:\\recordings\\camera7\\20260517_010000.mp4' },
            stats: { size: 100 },
        });
    });

    it('returns 416 for unsatisfiable recording byte ranges', async () => {
        const reply = createReply();

        await streamSegment({
            params: { cameraId: 7, filename: '20260517_010000.mp4' },
            headers: { range: 'bytes=100-101' },
        }, reply);

        expect(reply.code).toHaveBeenCalledWith(416);
        expect(reply.header).toHaveBeenCalledWith('Content-Range', 'bytes */100');
        expect(reply.send).toHaveBeenCalledWith({
            success: false,
            message: 'range_not_satisfiable',
        });
        expect(createReadStreamMock).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 5: Validate path in playback service**

In `recordingPlaybackService.js`, import:

```javascript
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { isSafeRecordingFilePath } from './recordingPathSafetyPolicy.js';
```

Add base path constants:

```javascript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const RECORDINGS_BASE_PATH = join(__dirname, '..', '..', 'recordings');
```

Before `existsSync(segment.file_path)` in `getStreamSegment`, add:

```javascript
        if (!isSafeRecordingFilePath({
            recordingsBasePath: RECORDINGS_BASE_PATH,
            cameraId,
            filePath: segment.file_path,
            filename,
        })) {
            const err = new Error('Segment file path is not safe');
            err.statusCode = 403;
            throw err;
        }
```

- [ ] **Step 6: Use direct token window authorization**

In `getStreamSegment`, replace token full preview list check with direct window lookup:

```javascript
            if (access.accessMode === 'token_full') {
                const cutoffIso = access.playbackWindowHours
                    ? new Date(Date.now() - access.playbackWindowHours * 60 * 60 * 1000).toISOString()
                    : null;
                const allowedSegment = recordingSegmentRepository.findSegmentInWindow({
                    cameraId,
                    filename,
                    startAfterIso: cutoffIso,
                });
                if (!allowedSegment) {
                    const err = new Error('Segment not available for this playback scope');
                    err.statusCode = 403;
                    throw err;
                }
            } else {
                const previewSegments = recordingSegmentRepository.findPlaybackSegments({
                    cameraId,
                    order: 'latest',
                    limit: getPreviewSegmentLimit(access.previewMinutes),
                    returnAscending: true,
                });
                if (!previewSegments.some((item) => item.filename === filename)) {
                    const err = new Error('Segment not available for this playback scope');
                    err.statusCode = 403;
                    throw err;
                }
            }
```

- [ ] **Step 7: Validate byte ranges in controller**

In `backend/controllers/recordingController.js`, import:

```javascript
import { normalizeRecordingRange } from '../services/recordingPathSafetyPolicy.js';
```

Replace range parsing block with:

```javascript
        const range = normalizeRecordingRange({
            rangeHeader: request.headers.range,
            fileSize: stats.size,
        });
        if (!range.valid) {
            return reply
                .code(range.statusCode)
                .header('Content-Range', `bytes */${stats.size}`)
                .send({ success: false, message: range.reason });
        }

        if (range.partial) {
            reply.code(206);
            reply.header('Content-Range', range.contentRange);
            reply.header('Content-Length', range.chunkSize);

            const stream = createReadStream(segment.file_path, { start: range.start, end: range.end });
            return reply.send(stream);
        }
```

- [ ] **Step 8: Run focused playback tests**

Run:

```bash
cd backend
npm test -- recordingSegmentRepository.test.js recordingPlaybackService.test.js recordingController.test.js recordingPathSafetyPolicy.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit and push**

Run:

```bash
git status
git add backend/services/recordingSegmentRepository.js backend/services/recordingPlaybackService.js backend/controllers/recordingController.js backend/__tests__/recordingSegmentRepository.test.js backend/__tests__/recordingPlaybackService.test.js backend/__tests__/recordingController.test.js
git commit -m "Fix: harden recording playback file access"
git push
```

DB-heavy justification: stream authorization becomes a single indexed `(camera_id, filename)` or `(camera_id, filename, start_time)` lookup instead of loading up to 1000 segments and scanning in memory.

---

### Task 9: Recording Settings Validation

**Files:**
- Modify: `backend/services/recordingPlaybackService.js`
- Test: `backend/__tests__/recordingPlaybackService.test.js`

- [ ] **Step 1: Add failing settings validation tests**

Add to `backend/__tests__/recordingPlaybackService.test.js`:

```javascript
it('rejects enabling recording for non-recordable delivery types', async () => {
    queryOneMock.mockReturnValueOnce({
        id: 7,
        name: 'CCTV MJPEG',
        enabled: 1,
        delivery_type: 'external_mjpeg',
        stream_source: 'external',
    });

    await expect(recordingPlaybackService.updateRecordingSettings(
        7,
        { enable_recording: true },
        { user: { id: 1 } }
    )).rejects.toMatchObject({
        statusCode: 400,
        message: 'Recording only supports internal HLS or external HLS cameras',
    });

    expect(executeMock).not.toHaveBeenCalledWith(
        expect.stringContaining('UPDATE cameras SET enable_recording'),
        expect.any(Array)
    );
});

it('rejects recording retention outside accepted bounds', async () => {
    queryOneMock.mockReturnValueOnce({
        id: 7,
        name: 'CCTV HLS',
        enabled: 1,
        delivery_type: 'internal_hls',
        stream_source: 'internal',
    });

    await expect(recordingPlaybackService.updateRecordingSettings(
        7,
        { recording_duration_hours: 3000 },
        { user: { id: 1 } }
    )).rejects.toMatchObject({
        statusCode: 400,
        message: 'Recording retention must be between 1 and 2160 hours',
    });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js
```

Expected: new tests fail.

- [ ] **Step 3: Implement validation**

In `recordingPlaybackService.js`, import:

```javascript
import { getEffectiveDeliveryType } from '../utils/cameraDelivery.js';
```

Add helpers near constants:

```javascript
const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

function assertRecordingSettingsAllowed(camera, data) {
    if (data.recording_duration_hours !== undefined) {
        const hours = Number(data.recording_duration_hours);
        if (!Number.isInteger(hours) || hours < 1 || hours > 2160) {
            const err = new Error('Recording retention must be between 1 and 2160 hours');
            err.statusCode = 400;
            throw err;
        }
    }

    if (data.enable_recording === true || data.enable_recording === 1) {
        const deliveryType = getEffectiveDeliveryType(camera);
        if (!RECORDABLE_DELIVERY_TYPES.has(deliveryType)) {
            const err = new Error('Recording only supports internal HLS or external HLS cameras');
            err.statusCode = 400;
            throw err;
        }
    }
}
```

Call after camera lookup:

```javascript
        assertRecordingSettingsAllowed(camera, data);
```

- [ ] **Step 4: Run passing test**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status
git add backend/services/recordingPlaybackService.js backend/__tests__/recordingPlaybackService.test.js
git commit -m "Fix: validate recording settings safely"
git push
```

---

### Task 10: Remove Legacy Direct Delete Helpers From Recording Facade

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/services/recordingCleanupService.js`
- Test: `backend/__tests__/recordingService.test.js`
- Test: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add source-level guard tests**

Add to `backend/__tests__/recordingService.test.js`:

```javascript
it('does not keep local recording delete or quarantine helpers in the facade', async () => {
    const { readFile } = await import('fs/promises');
    const source = await readFile(new URL('../services/recordingService.js', import.meta.url), 'utf8');

    expect(source).not.toContain('async function deleteRecordingFileSafely');
    expect(source).not.toContain('async function quarantineRecordingFile');
    expect(source).toContain("recordingFileOperationService");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
cd backend
npm test -- recordingService.test.js
```

Expected: fails while local helpers remain.

- [ ] **Step 3: Replace local helpers with file operation service**

In `recordingService.js`, remove local `isPathInside`, `isSafeRecordingFilePath`, `deleteRecordingFileSafely`, and `quarantineRecordingFile`.

Create an operation service instance:

```javascript
const fileOperations = createRecordingFileOperationService({
    recordingsBasePath: RECORDINGS_BASE_PATH,
    logger: console,
});
```

Wire cleanup service:

```javascript
const cleanupService = createRecordingCleanupService({
    repository: recordingSegmentRepository,
    recordingsBasePath: RECORDINGS_BASE_PATH,
    safeDelete: fileOperations.deleteFileSafely,
    isFileBeingProcessed: (targetCameraId, filename) => filesBeingProcessed.has(`${targetCameraId}:${filename}`)
        || recordingRecoveryService.isFileOwned(targetCameraId, filename),
    onRecoverOrphan: ({ cameraId, filename, filePath, sourceType }) => recordingRecoveryService.recoverNow({
        cameraId,
        filename,
        sourcePath: filePath,
        sourceType,
    }),
    logger: console,
});
```

Replace failed-remux quarantine call:

```javascript
    const result = await fileOperations.quarantineFile({ cameraId, filename, filePath, reason });
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingCleanupService.test.js recordingFileOperationService.test.js recordingRecoveryService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit and push**

Run:

```bash
git status
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Refactor: centralize recording file operations"
git push
```

---

### Task 11: Full Backend Gate And Operational Audit

**Files:**
- Modify only if tests expose gaps:
  - `backend/services/.module_map.md`
  - impacted service/test files from prior tasks

- [ ] **Step 1: Run migrations**

Run:

```bash
cd backend
npm run migrate
```

Expected: all migrations complete successfully.

- [ ] **Step 2: Run full backend tests**

Run:

```bash
cd backend
npm test
```

Expected: all backend test files pass.

- [ ] **Step 3: Inspect direct destructive paths**

Run:

```bash
cd C:\project\cctv
rg "unlink\\(|unlinkSync|rm\\(|Remove-Item|quarantineFile|deleteFileSafely" backend/services backend/controllers backend/routes
```

Expected:

```text
backend/services/recordingFileOperationService.js
backend/services/recordingCleanupService.js
backend/services/recordingRecoveryService.js
```

Other matches must be unrelated non-recording domains or existing safe temp cleanup with a test. If a recording-domain direct `unlink` remains outside `recordingFileOperationService.js`, move it behind the file operation service before proceeding.

- [ ] **Step 4: Inspect DB indexes**

Run:

```bash
cd backend
node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database('data/cctv.db', { readonly: true }); for (const table of ['recording_segments','recording_recovery_diagnostics']) { console.log(table, db.prepare('PRAGMA index_list(' + table + ')').all().map(row => row.name)); } db.close();"
```

Expected: `recording_segments` includes indexes for `(camera_id,start_time)`, `(camera_id,filename)`, and `(start_time,id)`; `recording_recovery_diagnostics` includes active file/state/attempt indexes.

- [ ] **Step 5: Commit and push final verification updates**

Run only if files changed during audit:

```bash
git status
git add backend/services/.module_map.md backend/services/recordingService.js backend/services/recordingCleanupService.js backend/services/recordingPlaybackService.js backend/controllers/recordingController.js backend/__tests__/recordingService.test.js backend/__tests__/recordingCleanupService.test.js backend/__tests__/recordingPlaybackService.test.js backend/__tests__/recordingController.test.js
git commit -m "Fix: complete recording cleanup hardening"
git push
```

Expected: active branch is pushed.

---

## Rollout Notes

- Keep permanent deletion behavior conservative in the first implementation: final orphans and unrecoverable partials move to quarantine, not immediate delete.
- Quarantine cleanup can be planned separately after operators verify no valid files are landing there.
- If disk pressure is severe, emergency cleanup may delete expired DB-backed segments through `recordingCleanupService`, but final filesystem orphans still pass through recovery/quarantine first.
- Long-retention playback must not depend on loading the first 1000 oldest rows for stream authorization.

## Self-Review

- Spec coverage: storage ownership, cleanup safety, recovery queueing, path safety, timestamp consistency, disabled-camera recovery, playback stream authorization, settings validation, DB indexes, and verification gates are covered by Tasks 1-11.
- Red-flag scan: the plan avoids deferred sections, unspecified test steps, and unnamed changed-file targets.
- Type consistency: planned function names are stable: `isSafeRecordingFilePath`, `normalizeRecordingRange`, `parseRecordingFilenameTimestampMs`, `createRecordingFileOperationService`, `createRecordingRecoveryService`, `recoverNow`, `enqueue`, `drain`, and `isFileOwned`.
