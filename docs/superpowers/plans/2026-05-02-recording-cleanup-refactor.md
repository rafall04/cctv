<!--
Purpose: Provide the implementation plan for refactoring old recording segment cleanup.
Caller: Superpowers writing-plans handoff after approved cleanup design.
Deps: docs/superpowers/specs/2026-05-02-recording-cleanup-refactor-design.md, backend recording services, Vitest.
MainFuncs: retention policy extraction, segment repository extraction, cleanup orchestration extraction, playback query boundary.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Recording Cleanup Refactor Implementation Plan

> Execution order note: this plan is still valid, but cross-plan priority and missing integrity work are now coordinated by `docs/superpowers/plans/2026-05-03-recording-stabilization-priority-plan.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor recording segment cleanup into focused policy, repository, and cleanup service units so retention cleanup is bounded, testable, and ready for future playback features.

**Architecture:** Keep `recordingService.js` as the recording lifecycle facade while extracting pure retention decisions, SQLite segment queries, and cleanup orchestration into separate backend service modules. Preserve existing public methods during migration, especially `recordingService.cleanupOldSegments(cameraId)`, so routes and health flows keep working.

**Tech Stack:** Node.js 20 ES modules, Fastify backend service layer, better-sqlite3 via `connectionPool.js`, Vitest backend tests.

---

## File Structure

- Create `backend/services/recordingRetentionPolicy.js`: pure helpers for retention cutoff, filename parsing, and safe recording filename checks.
- Create `backend/services/recordingSegmentRepository.js`: bounded SQLite access for cleanup and playback segment queries.
- Create `backend/services/recordingCleanupService.js`: cleanup orchestration with per-camera in-flight locking and structured counters.
- Modify `backend/services/recordingService.js`: delegate cleanup internals through `recordingCleanupService` while keeping lifecycle behavior and compatibility wrappers.
- Modify `backend/services/recordingPlaybackService.js`: use repository methods for segment listing and stream lookup.
- Create `backend/__tests__/recordingRetentionPolicy.test.js`: pure policy tests.
- Create `backend/__tests__/recordingSegmentRepository.test.js`: SQL shape and parameter tests.
- Create `backend/__tests__/recordingCleanupService.test.js`: cleanup orchestration tests with mocked filesystem and repository.
- Modify `backend/__tests__/recordingService.test.js`: keep existing regression tests and update expectations only where the delegation boundary changes.
- Modify `backend/__tests__/recordingPlaybackService.test.js`: assert latest public preview selection and stream lookup without loading all segments.
- Create `backend/database/migrations/add_recording_segment_filename_index.js`: idempotent `(camera_id, filename)` lookup index for stream-by-filename access.

---

### Task 1: Extract Retention Policy

**Files:**
- Create: `backend/services/recordingRetentionPolicy.js`
- Create: `backend/__tests__/recordingRetentionPolicy.test.js`
- Modify: `backend/services/recordingService.js:109-136`

- [ ] **Step 1: Write failing policy tests**

Create `backend/__tests__/recordingRetentionPolicy.test.js`:

```javascript
/**
 * Purpose: Validate pure retention cutoff, filename parsing, and safe filename checks.
 * Caller: Vitest backend test suite.
 * Deps: recordingRetentionPolicy service.
 * MainFuncs: computeRetentionWindow, parseSegmentFilenameTimeMs, isSafeRecordingFilename.
 * SideEffects: None; pure function tests only.
 */
import { describe, expect, it } from 'vitest';
import {
    computeRetentionWindow,
    isExpiredByRetention,
    isSafeRecordingFilename,
    parseSegmentFilenameTimeMs,
} from '../services/recordingRetentionPolicy.js';

describe('recordingRetentionPolicy', () => {
    it('computes retention cutoff with the larger grace value', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');

        const result = computeRetentionWindow({
            retentionHours: 1,
            nowMs,
        });

        expect(result.retentionMs).toBe(60 * 60 * 1000);
        expect(result.graceMs).toBe(10 * 60 * 1000);
        expect(result.cutoffMs).toBe(nowMs - (70 * 60 * 1000));
        expect(result.cutoffIso).toBe(new Date(nowMs - (70 * 60 * 1000)).toISOString());
    });

    it('defaults invalid retention hours to five hours', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');

        const result = computeRetentionWindow({
            retentionHours: 0,
            nowMs,
        });

        expect(result.retentionHours).toBe(5);
        expect(result.retentionMs).toBe(5 * 60 * 60 * 1000);
    });

    it('parses segment filenames deterministically as UTC timestamps', () => {
        expect(parseSegmentFilenameTimeMs('20260502_174501.mp4')).toBe(
            Date.UTC(2026, 4, 2, 17, 45, 1)
        );
    });

    it('rejects filenames that only contain temp or remux fragments', () => {
        expect(isSafeRecordingFilename('20260502_174501.mp4')).toBe(true);
        expect(isSafeRecordingFilename('20260502_174501.mp4.remux.mp4')).toBe(true);
        expect(isSafeRecordingFilename('20260502_174501.mp4.temp.mp4')).toBe(true);
        expect(isSafeRecordingFilename('x.temp.mp4')).toBe(false);
        expect(isSafeRecordingFilename('20260502_174501.mp4.temp.mp4.exe')).toBe(false);
        expect(isSafeRecordingFilename('../20260502_174501.mp4')).toBe(false);
    });

    it('marks a segment expired only after retention plus grace', () => {
        const nowMs = Date.parse('2026-05-02T10:00:00.000Z');
        const window = computeRetentionWindow({ retentionHours: 1, nowMs });

        expect(isExpiredByRetention('2026-05-02T08:40:00.000Z', window)).toBe(true);
        expect(isExpiredByRetention('2026-05-02T09:00:00.000Z', window)).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
```

Expected: FAIL because `../services/recordingRetentionPolicy.js` does not exist.

- [ ] **Step 3: Create minimal policy implementation**

Create `backend/services/recordingRetentionPolicy.js`:

```javascript
// Purpose: Provide pure retention and recording filename decisions for cleanup flows.
// Caller: recordingService, recordingCleanupService, recordingRetentionPolicy tests.
// Deps: Node path basename utility.
// MainFuncs: computeRetentionWindow, parseSegmentFilenameTimeMs, isSafeRecordingFilename, isExpiredByRetention.
// SideEffects: None.

import { basename } from 'path';

export const RECORDING_RETENTION_GRACE_MS = 10 * 60 * 1000;
export const DEFAULT_RECORDING_RETENTION_HOURS = 5;

const FINAL_SEGMENT_PATTERN = /^\d{8}_\d{6}\.mp4$/;
const TEMP_SEGMENT_PATTERN = /^\d{8}_\d{6}\.mp4\.(remux|temp)\.mp4$/;

export function normalizeRetentionHours(retentionHours) {
    const parsed = Number(retentionHours);
    return Number.isFinite(parsed) && parsed > 0
        ? parsed
        : DEFAULT_RECORDING_RETENTION_HOURS;
}

export function computeRetentionWindow({ retentionHours, nowMs = Date.now() }) {
    const normalizedHours = normalizeRetentionHours(retentionHours);
    const retentionMs = normalizedHours * 60 * 60 * 1000;
    const graceMs = Math.max(RECORDING_RETENTION_GRACE_MS, retentionMs * 0.1);
    const retentionWithGraceMs = retentionMs + graceMs;
    const cutoffMs = nowMs - retentionWithGraceMs;

    return {
        retentionHours: normalizedHours,
        retentionMs,
        graceMs,
        retentionWithGraceMs,
        cutoffMs,
        cutoffIso: new Date(cutoffMs).toISOString(),
    };
}

export function parseSegmentFilenameTimeMs(filename) {
    const safeName = basename(String(filename || ''));
    const match = safeName.match(/^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})\.mp4$/);

    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match.map(Number);
    return Date.UTC(year, month - 1, day, hour, minute, second);
}

export function isSafeRecordingFilename(filename) {
    const value = String(filename || '');
    if (value !== basename(value)) {
        return false;
    }

    return FINAL_SEGMENT_PATTERN.test(value) || TEMP_SEGMENT_PATTERN.test(value);
}

export function getSegmentAgeMs({ filename, startTime, fileMtimeMs, nowMs = Date.now() }) {
    const filenameTimeMs = parseSegmentFilenameTimeMs(filename);
    const startTimeMs = startTime ? Date.parse(startTime) : NaN;
    const candidates = [filenameTimeMs, startTimeMs, fileMtimeMs]
        .filter((value) => Number.isFinite(value));

    if (candidates.length === 0) {
        return 0;
    }

    const oldestTimeMs = Math.min(...candidates);
    return Math.max(0, nowMs - oldestTimeMs);
}

export function isExpiredByRetention(startTime, retentionWindow) {
    const startMs = Date.parse(startTime);
    return Number.isFinite(startMs) && startMs < retentionWindow.cutoffMs;
}
```

- [ ] **Step 4: Delegate filename validation from recordingService**

Replace `backend/services/recordingService.js:109-136` helper internals so `isSafeRecordingFilePath` uses `isSafeRecordingFilename`.

```javascript
import {
    computeRetentionWindow,
    getSegmentAgeMs,
    isExpiredByRetention,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';
```

Update the helper return:

```javascript
const fileName = filename || basename(resolvedPath);
return isSafeRecordingFilename(fileName);
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
npm test -- recordingService.test.js
```

Expected: both suites PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingRetentionPolicy.js backend/services/recordingService.js backend/__tests__/recordingRetentionPolicy.test.js
git commit -m "Add: recording retention policy"
git push origin main
```

---

### Task 2: Add Segment Repository

**Files:**
- Create: `backend/services/recordingSegmentRepository.js`
- Create: `backend/__tests__/recordingSegmentRepository.test.js`
- Create: `backend/database/migrations/add_recording_segment_filename_index.js`

- [ ] **Step 1: Write failing repository tests**

Create `backend/__tests__/recordingSegmentRepository.test.js`:

```javascript
/**
 * Purpose: Validate bounded SQL access for recording segment cleanup and playback.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool and recordingSegmentRepository.
 * MainFuncs: findExpiredSegments, findPlaybackSegments, findSegmentByFilename.
 * SideEffects: None; database calls are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();
const executeMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    query: queryMock,
    queryOne: queryOneMock,
    execute: executeMock,
}));

const { default: recordingSegmentRepository } = await import('../services/recordingSegmentRepository.js');

describe('recordingSegmentRepository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('fetches expired cleanup candidates with camera cutoff and limit', () => {
        queryMock.mockReturnValueOnce([]);

        recordingSegmentRepository.findExpiredSegments({
            cameraId: 7,
            cutoffIso: '2026-05-02T09:00:00.000Z',
            limit: 6,
        });

        expect(queryMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND start_time < ?'),
            [7, '2026-05-02T09:00:00.000Z', 6]
        );
        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time ASC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
    });

    it('fetches latest playback preview with bounded descending SQL then returns ascending order', () => {
        queryMock.mockReturnValueOnce([
            { id: 2, filename: '20260502_101000.mp4', start_time: '2026-05-02T10:10:00.000Z' },
            { id: 1, filename: '20260502_100000.mp4', start_time: '2026-05-02T10:00:00.000Z' },
        ]);

        const result = recordingSegmentRepository.findPlaybackSegments({
            cameraId: 9,
            order: 'latest',
            limit: 2,
            returnAscending: true,
        });

        expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
        expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
        expect(queryMock.mock.calls[0][1]).toEqual([9, 2]);
        expect(result.map((segment) => segment.id)).toEqual([1, 2]);
    });

    it('looks up a stream segment by camera and filename', () => {
        queryOneMock.mockReturnValueOnce({ id: 5, filename: '20260502_100000.mp4' });

        const result = recordingSegmentRepository.findSegmentByFilename({
            cameraId: 3,
            filename: '20260502_100000.mp4',
        });

        expect(result.id).toBe(5);
        expect(queryOneMock).toHaveBeenCalledWith(
            expect.stringContaining('WHERE camera_id = ? AND filename = ?'),
            [3, '20260502_100000.mp4']
        );
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingSegmentRepository.test.js
```

Expected: FAIL because `recordingSegmentRepository.js` does not exist.

- [ ] **Step 3: Create repository implementation**

Create `backend/services/recordingSegmentRepository.js`:

```javascript
// Purpose: Centralize bounded SQLite queries for recording segment cleanup and playback.
// Caller: recordingCleanupService, recordingPlaybackService, repository tests.
// Deps: SQLite connectionPool query/queryOne/execute helpers.
// MainFuncs: findExpiredSegments, findPlaybackSegments, findSegmentByFilename, deleteSegmentById.
// SideEffects: Reads and deletes recording_segments rows.

import { execute, query, queryOne } from '../database/connectionPool.js';

const SEGMENT_SELECT_FIELDS = `
    id,
    camera_id,
    filename,
    start_time,
    end_time,
    file_size,
    duration,
    created_at,
    file_path
`;

class RecordingSegmentRepository {
    findExpiredSegments({ cameraId, cutoffIso, limit }) {
        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND start_time < ?
            ORDER BY start_time ASC
            LIMIT ?`,
            [cameraId, cutoffIso, limit]
        );
    }

    findMissingFileCandidates({ cameraId, olderThanIso, limit }) {
        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND start_time < ?
            ORDER BY start_time ASC
            LIMIT ?`,
            [cameraId, olderThanIso, limit]
        );
    }

    listFilenamesByCamera(cameraId) {
        return query(
            'SELECT filename FROM recording_segments WHERE camera_id = ?',
            [cameraId]
        ).map((row) => row.filename);
    }

    deleteSegmentById(id) {
        return execute('DELETE FROM recording_segments WHERE id = ?', [id]);
    }

    findPlaybackSegments({ cameraId, order = 'oldest', limit = 500, returnAscending = false }) {
        const direction = order === 'latest' ? 'DESC' : 'ASC';
        const rows = query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ?
            ORDER BY start_time ${direction}
            LIMIT ?`,
            [cameraId, limit]
        );

        if (returnAscending && direction === 'DESC') {
            return [...rows].reverse();
        }

        return rows;
    }

    findSegmentByFilename({ cameraId, filename }) {
        return queryOne(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            WHERE camera_id = ? AND filename = ?`,
            [cameraId, filename]
        );
    }
}

export default new RecordingSegmentRepository();
```

- [ ] **Step 4: Add filename index migration**

Create `backend/database/migrations/add_recording_segment_filename_index.js`. The migration is idempotent, so it is safe when the index already exists.

```javascript
// Purpose: Add filename lookup index for playback stream segment access.
// Caller: Backend migration runner.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates idx_recording_segments_camera_filename when missing.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_recording_segments_camera_filename
        ON recording_segments(camera_id, filename)
    `);
    console.log('Created index idx_recording_segments_camera_filename');
} finally {
    db.close();
}
```

- [ ] **Step 5: Run repository tests**

Run:

```bash
cd backend
npm test -- recordingSegmentRepository.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingSegmentRepository.js backend/__tests__/recordingSegmentRepository.test.js backend/database/migrations/add_recording_segment_filename_index.js
git commit -m "Add: recording segment repository"
git push origin main
```

---

### Task 3: Extract Cleanup Service

**Files:**
- Create: `backend/services/recordingCleanupService.js`
- Create: `backend/__tests__/recordingCleanupService.test.js`
- Modify: `backend/services/recordingService.js:944-1220`

- [ ] **Step 1: Write failing cleanup service tests**

Create `backend/__tests__/recordingCleanupService.test.js`:

```javascript
/**
 * Purpose: Validate recording cleanup orchestration, locking, and counters.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs promises and segment repository.
 * MainFuncs: cleanupCamera.
 * SideEffects: Filesystem and database operations are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const repositoryMock = {
    findExpiredSegments: vi.fn(),
    findMissingFileCandidates: vi.fn(),
    listFilenamesByCamera: vi.fn(),
    deleteSegmentById: vi.fn(),
};

const fsMock = {
    access: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
};

const safeDeleteMock = vi.fn();
const isProcessingMock = vi.fn();

const { createRecordingCleanupService } = await import('../services/recordingCleanupService.js');

function createService() {
    return createRecordingCleanupService({
        repository: repositoryMock,
        fs: fsMock,
        recordingsBasePath: 'C:\\project\\cctv\\recordings',
        safeDelete: safeDeleteMock,
        isFileBeingProcessed: isProcessingMock,
        logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
    });
}

describe('recordingCleanupService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        repositoryMock.findExpiredSegments.mockReturnValue([]);
        repositoryMock.findMissingFileCandidates.mockReturnValue([]);
        repositoryMock.listFilenamesByCamera.mockReturnValue([]);
        repositoryMock.deleteSegmentById.mockReturnValue(undefined);
        fsMock.access.mockResolvedValue(undefined);
        fsMock.readdir.mockResolvedValue([]);
        fsMock.stat.mockResolvedValue({ size: 1024, mtimeMs: Date.parse('2026-05-02T08:00:00.000Z') });
        safeDeleteMock.mockResolvedValue({ success: true, size: 1024 });
        isProcessingMock.mockReturnValue(false);
    });

    it('deletes expired DB-tracked files and rows in a bounded batch', async () => {
        repositoryMock.findExpiredSegments.mockReturnValueOnce([
            {
                id: 1,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: 'C:\\project\\cctv\\recordings\\camera7\\20260502_080000.mp4',
            },
        ]);

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(repositoryMock.findExpiredSegments).toHaveBeenCalledWith({
            cameraId: 7,
            cutoffIso: '2026-05-02T08:50:00.000Z',
            limit: 6,
        });
        expect(safeDeleteMock).toHaveBeenCalled();
        expect(repositoryMock.deleteSegmentById).toHaveBeenCalledWith(1);
        expect(result.deleted).toBe(1);
    });

    it('skips DB deletion when safe delete rejects an unsafe path', async () => {
        repositoryMock.findExpiredSegments.mockReturnValueOnce([
            {
                id: 2,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: 'C:\\escape\\20260502_080000.mp4',
            },
        ]);
        safeDeleteMock.mockResolvedValueOnce({ success: false, reason: 'unsafe_path' });

        const service = createService();
        const result = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(repositoryMock.deleteSegmentById).not.toHaveBeenCalledWith(2);
        expect(result.unsafeSkipped).toBe(1);
    });

    it('prevents overlapping cleanup for the same camera', async () => {
        let releaseDelete;
        safeDeleteMock.mockReturnValueOnce(new Promise((resolve) => {
            releaseDelete = () => resolve({ success: true, size: 1024 });
        }));
        repositoryMock.findExpiredSegments.mockReturnValue([
            {
                id: 3,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                start_time: '2026-05-02T08:00:00.000Z',
                file_path: 'C:\\project\\cctv\\recordings\\camera7\\20260502_080000.mp4',
            },
        ]);

        const service = createService();
        const firstRun = service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });
        const secondRun = await service.cleanupCamera({
            cameraId: 7,
            camera: { recording_duration_hours: 1, name: 'Camera 7' },
            nowMs: Date.parse('2026-05-02T10:00:00.000Z'),
        });

        expect(secondRun.skippedReason).toBe('cleanup_in_flight');
        releaseDelete();
        await firstRun;
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: FAIL because `recordingCleanupService.js` does not exist.

- [ ] **Step 3: Create cleanup service implementation**

Create `backend/services/recordingCleanupService.js`:

```javascript
// Purpose: Orchestrate recording segment cleanup with bounded batches and per-camera locking.
// Caller: recordingService scheduled cleanup and cleanup tests.
// Deps: fs promises, path join, recording retention policy, segment repository.
// MainFuncs: createRecordingCleanupService, cleanupCamera.
// SideEffects: Deletes recording files through injected safeDelete and removes DB rows through repository.

import { promises as defaultFs } from 'fs';
import { join } from 'path';
import {
    computeRetentionWindow,
    getSegmentAgeMs,
    isSafeRecordingFilename,
} from './recordingRetentionPolicy.js';

const NORMAL_DELETE_BATCH_SIZE = 6;
function createEmptyResult() {
    return {
        deleted: 0,
        deletedBytes: 0,
        missingRowsDeleted: 0,
        unsafeSkipped: 0,
        processingSkipped: 0,
        failed: 0,
        orphanDeleted: 0,
        skippedReason: null,
    };
}

export function createRecordingCleanupService({
    repository,
    fs = defaultFs,
    recordingsBasePath,
    safeDelete,
    isFileBeingProcessed,
    logger = console,
} = {}) {
    const inFlightCameraIds = new Set();

    async function cleanupExpiredDbSegments({ cameraId, retentionWindow, result }) {
        const segments = repository.findExpiredSegments({
            cameraId,
            cutoffIso: retentionWindow.cutoffIso,
            limit: NORMAL_DELETE_BATCH_SIZE,
        });

        for (const segment of segments) {
            if (isFileBeingProcessed?.(cameraId, segment.filename)) {
                result.processingSkipped++;
                continue;
            }

            let fileExists = true;
            try {
                await fs.access(segment.file_path);
            } catch {
                fileExists = false;
            }

            if (!fileExists) {
                repository.deleteSegmentById(segment.id);
                result.missingRowsDeleted++;
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename: segment.filename,
                filePath: segment.file_path,
                reason: 'retention_expired',
            });

            if (!deleteResult.success) {
                if (deleteResult.reason === 'unsafe_path') {
                    result.unsafeSkipped++;
                } else {
                    result.failed++;
                }
                continue;
            }

            repository.deleteSegmentById(segment.id);
            result.deleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    }

    async function cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result }) {
        const cameraDir = join(recordingsBasePath, `camera${cameraId}`);
        try {
            await fs.access(cameraDir);
        } catch {
            return;
        }

        const filenames = await fs.readdir(cameraDir);
        const dbFilenames = new Set(repository.listFilenamesByCamera(cameraId));

        for (const filename of filenames) {
            if (!isSafeRecordingFilename(filename) || dbFilenames.has(filename)) {
                continue;
            }
            if (isFileBeingProcessed?.(cameraId, filename)) {
                result.processingSkipped++;
                continue;
            }

            const filePath = join(cameraDir, filename);
            let stats;
            try {
                stats = await fs.stat(filePath);
            } catch {
                result.failed++;
                continue;
            }

            const ageMs = getSegmentAgeMs({ filename, fileMtimeMs: stats.mtimeMs, nowMs });
            if (ageMs <= retentionWindow.retentionWithGraceMs) {
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId,
                filename,
                filePath,
                reason: 'filesystem_orphan_retention_expired',
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

    async function cleanupCamera({ cameraId, camera, nowMs = Date.now() }) {
        if (inFlightCameraIds.has(cameraId)) {
            return { ...createEmptyResult(), skippedReason: 'cleanup_in_flight' };
        }

        inFlightCameraIds.add(cameraId);
        const result = createEmptyResult();

        try {
            const retentionWindow = computeRetentionWindow({
                retentionHours: camera?.recording_duration_hours,
                nowMs,
            });

            await cleanupExpiredDbSegments({ cameraId, retentionWindow, result });
            await cleanupFilesystemOrphans({ cameraId, retentionWindow, nowMs, result });

            logger.log?.(`[Cleanup] Camera ${cameraId} summary: ${JSON.stringify(result)}`);
            return result;
        } finally {
            inFlightCameraIds.delete(cameraId);
        }
    }

    return { cleanupCamera };
}
```

- [ ] **Step 4: Wire recordingService cleanup wrapper**

In `backend/services/recordingService.js`, import the cleanup service factory and repository:

```javascript
import { createRecordingCleanupService } from './recordingCleanupService.js';
import recordingSegmentRepository from './recordingSegmentRepository.js';
```

Create the cleanup service after helper declarations and before the class:

```javascript
const cleanupService = createRecordingCleanupService({
    repository: recordingSegmentRepository,
    recordingsBasePath: RECORDINGS_BASE_PATH,
    safeDelete: deleteRecordingFileSafely,
    isFileBeingProcessed: (targetCameraId, filename) => filesBeingProcessed.has(`${targetCameraId}:${filename}`),
    logger: console,
});
```

Replace the body of `cleanupOldSegments(cameraId)` with this compatibility wrapper:

```javascript
async cleanupOldSegments(cameraId) {
    try {
        const now = Date.now();
        if (!this.lastCleanupTime) this.lastCleanupTime = {};

        const lastCleanup = this.lastCleanupTime[cameraId] || 0;
        const timeSinceLastCleanup = now - lastCleanup;

        if (timeSinceLastCleanup < 60000) {
            console.log(`[Cleanup] Skipping cleanup for camera ${cameraId} (last cleanup ${Math.round(timeSinceLastCleanup / 1000)}s ago)`);
            return;
        }

        this.lastCleanupTime[cameraId] = now;

        const camera = queryOne('SELECT recording_duration_hours, name FROM cameras WHERE id = ?', [cameraId]);
        if (!camera) {
            console.log(`[Cleanup] Camera ${cameraId} not found, skipping cleanup`);
            return;
        }

        return await cleanupService.cleanupCamera({
            cameraId,
            camera,
            nowMs: now,
        });
    } catch (error) {
        console.error(`[Cleanup] Error cleaning up camera ${cameraId}:`, error);
    }
}
```

- [ ] **Step 5: Run cleanup tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
npm test -- recordingService.test.js
```

Expected: both suites PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/services/recordingService.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Refactor: extract recording cleanup service"
git push origin main
```

---

### Task 4: Route Playback Through Repository

**Files:**
- Modify: `backend/services/recordingPlaybackService.js:289-416`
- Modify: `backend/__tests__/recordingPlaybackService.test.js`
- Modify: `backend/services/recordingSegmentRepository.js`

- [ ] **Step 1: Update playback tests for latest preview and filename lookup**

In `backend/__tests__/recordingPlaybackService.test.js`, update the public preview test expectation:

```javascript
it('returns the latest preview segments for public playback', () => {
    queryOneMock
        .mockReturnValueOnce({
            id: 9,
            name: 'CCTV TAMAN',
            public_playback_mode: 'inherit',
            public_playback_preview_minutes: null,
        })
        .mockReturnValueOnce({ value: '628111111111' });
    queryMock.mockReturnValueOnce([
        { id: 2, filename: 'second.mp4', start_time: '2026-03-20T10:10:00.000Z', end_time: '2026-03-20T10:20:00.000Z', duration: 600, file_path: 'b', file_size: 100, created_at: '2026-03-20T10:10:00.000Z' },
    ]);

    const result = recordingPlaybackService.getSegments(9, { query: {} });

    expect(result.playback_policy).toEqual(expect.objectContaining({
        accessMode: 'public_preview',
        previewMinutes: 10,
    }));
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].filename).toBe('second.mp4');
    expect(queryMock.mock.calls[0][0]).toContain('ORDER BY start_time DESC');
    expect(queryMock.mock.calls[0][0]).toContain('LIMIT ?');
});
```

Add stream lookup test:

```javascript
it('streams by filename without loading every segment for the camera', () => {
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
            filename: 'second.mp4',
            start_time: '2026-03-20T10:10:00.000Z',
            end_time: '2026-03-20T10:20:00.000Z',
            duration: 600,
            file_path: 'b',
            file_size: 100,
            created_at: '2026-03-20T10:10:00.000Z',
        });

    const result = recordingPlaybackService.getStreamSegment(9, 'second.mp4', { query: {} });

    expect(result.segment.filename).toBe('second.mp4');
    expect(queryOneMock.mock.calls[2][0]).toContain('WHERE camera_id = ? AND filename = ?');
    expect(queryMock).not.toHaveBeenCalledWith(expect.stringContaining('ORDER BY start_time ASC'), [9]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js
```

Expected: FAIL because current service returns the oldest public preview segment and stream lookup loads all accessible segments.

- [ ] **Step 3: Import repository in playback service**

In `backend/services/recordingPlaybackService.js`, add:

```javascript
import recordingSegmentRepository from './recordingSegmentRepository.js';
```

- [ ] **Step 4: Replace segment loading with repository calls**

Change `getAccessibleSegments(cameraId, request)` to choose query shape:

```javascript
const previewLimit = getPreviewSegmentLimit(access.previewMinutes);
const queryOptions = access.accessMode === 'admin_full'
    ? { cameraId, order: 'oldest', limit: 1000, returnAscending: true }
    : { cameraId, order: 'latest', limit: previewLimit, returnAscending: true };

const segmentsAscending = recordingSegmentRepository.findPlaybackSegments(queryOptions);
```

Then keep the existing empty-result checks and `segmentsDescending` response:

```javascript
if (segmentsAscending.length === 0) {
    const err = new Error('No segments found');
    err.statusCode = 404;
    throw err;
}

return {
    camera,
    access,
    segmentsAscending,
    segmentsDescending: [...segmentsAscending].sort(
        (left, right) => new Date(right.start_time) - new Date(left.start_time)
    ),
};
```

- [ ] **Step 5: Replace stream lookup**

Change `getStreamSegment(cameraId, filename, request)` to:

```javascript
const { access } = this.resolvePlaybackContext(cameraId, request);
const segment = recordingSegmentRepository.findSegmentByFilename({ cameraId, filename });

if (!segment) {
    const err = new Error('Segment not available for this playback scope');
    err.statusCode = 403;
    throw err;
}

if (access.accessMode !== 'admin_full') {
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

Add this method to `RecordingPlaybackService` before `getAccessibleSegments`:

```javascript
resolvePlaybackContext(cameraId, request) {
    const camera = this.getPlaybackCamera(cameraId);
    const access = this.resolvePlaybackAccess(camera, request);

    if (access.accessMode === 'public_denied') {
        const err = new Error('Playback publik tidak tersedia untuk kamera ini');
        err.statusCode = 403;
        err.playbackAccess = access;
        throw err;
    }

    return { camera, access };
}
```

- [ ] **Step 6: Run playback tests**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/recordingPlaybackService.js backend/services/recordingSegmentRepository.js backend/__tests__/recordingPlaybackService.test.js
git commit -m "Fix: bound playback segment queries"
git push origin main
```

---

### Task 5: Refactor Emergency Cleanup Progress

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/services/recordingService.js:1779-1920`
- Modify: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add emergency cleanup test**

Add to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('continues emergency cleanup after skipped processing files', async () => {
    repositoryMock.findOldestSegmentsForEmergency = vi.fn()
        .mockReturnValueOnce([
            {
                id: 1,
                camera_id: 7,
                filename: '20260502_080000.mp4',
                file_path: 'C:\\project\\cctv\\recordings\\camera7\\20260502_080000.mp4',
            },
            {
                id: 2,
                camera_id: 7,
                filename: '20260502_081000.mp4',
                file_path: 'C:\\project\\cctv\\recordings\\camera7\\20260502_081000.mp4',
            },
        ])
        .mockReturnValueOnce([]);
    isProcessingMock
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

    const service = createService();
    const result = await service.emergencyCleanup({
        freeBytes: 100,
        targetFreeBytes: 2000,
        batchLimit: 2,
    });

    expect(repositoryMock.deleteSegmentById).toHaveBeenCalledWith(2);
    expect(result.processingSkipped).toBe(1);
    expect(result.deleted).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
```

Expected: FAIL because `emergencyCleanup` is not implemented.

- [ ] **Step 3: Add emergency repository method**

Add to `backend/services/recordingSegmentRepository.js`:

```javascript
findOldestSegmentsForEmergency({ afterStartTime = null, afterId = 0, limit = 200 } = {}) {
    if (!afterStartTime) {
        return query(
            `SELECT ${SEGMENT_SELECT_FIELDS}
            FROM recording_segments
            ORDER BY start_time ASC, id ASC
            LIMIT ?`,
            [limit]
        );
    }

    return query(
        `SELECT ${SEGMENT_SELECT_FIELDS}
        FROM recording_segments
        WHERE start_time > ? OR (start_time = ? AND id > ?)
        ORDER BY start_time ASC, id ASC
        LIMIT ?`,
        [afterStartTime, afterStartTime, afterId, limit]
    );
}
```

- [ ] **Step 4: Add emergency cleanup orchestration**

Add `emergencyCleanup` to the object returned by `createRecordingCleanupService`:

```javascript
async function emergencyCleanup({ freeBytes, targetFreeBytes, batchLimit = 200 }) {
    const result = createEmptyResult();
    let cursor = null;
    let keepScanning = true;

    while (keepScanning && (freeBytes + result.deletedBytes) <= targetFreeBytes) {
        const segments = repository.findOldestSegmentsForEmergency({
            afterStartTime: cursor?.start_time || null,
            afterId: cursor?.id || 0,
            limit: batchLimit,
        });

        if (!segments.length) {
            break;
        }

        for (const segment of segments) {
            cursor = { start_time: segment.start_time, id: segment.id };

            if ((freeBytes + result.deletedBytes) > targetFreeBytes) {
                keepScanning = false;
                break;
            }

            if (isFileBeingProcessed?.(segment.camera_id, segment.filename)) {
                result.processingSkipped++;
                continue;
            }

            const deleteResult = await safeDelete({
                cameraId: segment.camera_id,
                filename: segment.filename,
                filePath: segment.file_path,
                reason: 'emergency_disk_cleanup',
            });

            if (!deleteResult.success) {
                result.failed++;
                continue;
            }

            repository.deleteSegmentById(segment.id);
            result.deleted++;
            result.deletedBytes += deleteResult.size || 0;
        }
    }

    return result;
}
```

Return it:

```javascript
return { cleanupCamera, emergencyCleanup };
```

- [ ] **Step 5: Delegate emergencyDiskSpaceCheck delete loop**

In `backend/services/recordingService.js:1817-1863`, replace the direct `while` loop with:

```javascript
const emergencyResult = await cleanupService.emergencyCleanup({
    freeBytes,
    targetFreeBytes: 2 * 1024 * 1024 * 1024,
    batchLimit: 200,
});

freedBytes += emergencyResult.deletedBytes;
deletedCount += emergencyResult.deleted;
```

Keep the existing filesystem orphan emergency scan until a separate task moves it.

- [ ] **Step 6: Run tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js
npm test -- recordingService.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/services/recordingService.js backend/services/recordingSegmentRepository.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: continue emergency recording cleanup"
git push origin main
```

---

### Task 6: Final Verification and Documentation Sync

**Files:**
- Modify: `docs/superpowers/specs/2026-05-02-recording-cleanup-refactor-design.md`
- Modify: `docs/superpowers/plans/2026-05-02-recording-cleanup-refactor.md`

- [ ] **Step 1: Run focused backend test suites**

Run:

```bash
cd backend
npm test -- recordingRetentionPolicy.test.js
npm test -- recordingSegmentRepository.test.js
npm test -- recordingCleanupService.test.js
npm test -- recordingService.test.js
npm test -- recordingPlaybackService.test.js
```

Expected: all focused suites PASS.

- [ ] **Step 2: Run full backend tests**

Run:

```bash
cd backend
npm test
```

Expected: all backend tests PASS.

- [ ] **Step 3: Check working tree**

Run:

```bash
git status --short
```

Expected: only intentional source, test, migration, and docs files are modified.

- [ ] **Step 4: Update spec if implementation changed a boundary**

If implementation uses a different exported function name or splits emergency filesystem orphan cleanup into a separate follow-up, update the spec with the actual final boundary. Use a strict patch, not a full rewrite.

- [ ] **Step 5: Commit final docs sync if files changed**

Run only if Step 4 changed docs:

```bash
git add docs/superpowers/specs/2026-05-02-recording-cleanup-refactor-design.md docs/superpowers/plans/2026-05-02-recording-cleanup-refactor.md
git commit -m "Add: sync recording cleanup refactor docs"
git push origin main
```

- [ ] **Step 6: Final status**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean working tree and recent commits for policy, repository, cleanup service, playback query, emergency cleanup, and docs sync when docs changed.

---

## Plan Self-Review

Spec coverage:
1. Retention policy extraction is covered in Task 1.
2. Bounded cleanup SQL and playback repository boundary are covered in Tasks 2 and 4.
3. Per-camera cleanup lock and structured counters are covered in Task 3.
4. Emergency cleanup progress is covered in Task 5.
5. Verification and docs sync are covered in Task 6.

Placeholder scan:
1. No placeholder markers are used.
2. Every task includes exact files, code blocks, commands, expected results, and commit steps.

Type consistency:
1. Repository method names are consistent across tests and implementation snippets.
2. Cleanup result keys are consistent across tests and service snippets.
3. Playback query options use the same `cameraId`, `order`, `limit`, and `returnAscending` names across tasks.
