<!--
Purpose: Prioritized implementation plan for end-to-end recording stabilization across integrity, lifecycle, cleanup, and assurance gaps.
Caller: Operator/agent after project-wide recording analysis and before execution.
Deps: SYSTEM_MAP.md, backend/services/.module_map.md, existing recording lifecycle/cleanup/retention specs and plans, Vitest backend/frontend suites.
MainFuncs: Define execution order, target files, failing tests, migration tasks, and verification commands for recording hardening.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Recording Stabilization Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize recording so segment registration is idempotent, cleanup is retention-safe and scalable, background lifecycle loops stop cleanly, and operators can see assurance failures before recordings silently degrade.

**Architecture:** Execute this as four dependent tracks. First lock data integrity and schema invariants around `recording_segments` and restart logs. Then isolate lifecycle schedulers from `recordingService.js`, harden cleanup/query performance, and finally expose assurance state in the admin UI. Existing plans for lifecycle, cleanup, and retention remain valid inputs, but this plan adds the missing project-wide ordering and the gaps found in the current codebase.

**Tech Stack:** Node.js 20 ES modules, Fastify backend services, SQLite via `better-sqlite3`, React 18/Vite frontend admin UI, Vitest backend/frontend tests.

---

## Scope And Sequence

This work spans multiple related subsystems, but they are coupled enough that one ordered plan is still practical:

1. Data integrity must land first so later scheduler and cleanup work cannot create duplicate rows.
2. Lifecycle scheduler extraction must land before more cleanup logic is added, otherwise timer leaks and overlapping loops stay hidden.
3. Cleanup/query scaling must land after data invariants so repository behavior is predictable.
4. Assurance/admin visibility should land last so the UI reflects the hardened backend model instead of a moving target.

## File Structure

- Create `backend/database/migrations/2026xxxx_add_recording_segment_uniqueness.js`: enforce idempotent segment identity and reconcile duplicate rows before adding a unique index.
- Modify `backend/services/recordingService.js`: replace ad hoc insert flow with repository-backed idempotent registration and remove embedded timer ownership.
- Modify `backend/services/recordingSegmentRepository.js`: add upsert/insert-or-ignore helpers, duplicate detection queries, cursor-based orphan helpers, and emergency candidate queries.
- Modify `backend/services/recordingPlaybackService.js`: move from `database.js` to `connectionPool.js` and stop request-path size reconciliation writes.
- Modify `backend/services/recordingAssuranceService.js`: move from `database.js` to `connectionPool.js` and expose stable summary fields for frontend.
- Modify `backend/services/recordingCleanupService.js`: add cursor-based or bounded orphan cleanup helpers and structured summary fields.
- Create `backend/services/recordingScheduler.js`: own scanner/background cleanup/scheduled cleanup timer lifecycle.
- Modify `backend/server.js`: start and stop recording scheduler explicitly in startup and shutdown order.
- Modify `backend/services/.module_map.md`: document new ownership split for recording scheduler, repository idempotency, and assurance flow.
- Create `backend/__tests__/recordingSegmentUniqueness.test.js`: verify duplicate-safe registration and migration assumptions.
- Modify `backend/__tests__/recordingService.test.js`: assert idempotent segment registration and no scheduler leakage after shutdown.
- Modify `backend/__tests__/recordingSegmentRepository.test.js`: add repository tests for upsert and bounded cursor queries.
- Modify `backend/__tests__/recordingPlaybackService.test.js`: assert no full-camera segment load for filename stream checks.
- Modify `backend/__tests__/recordingAssuranceService.test.js`: verify assurance summary shape used by UI.
- Modify `frontend/src/services/recordingService.js`: add assurance API client.
- Modify `frontend/src/hooks/admin/useRecordingDashboardData.js`: load assurance with existing overview/restart data.
- Modify `frontend/src/pages/RecordingDashboard.jsx`: surface assurance errors and stale/gap/down counts.
- Create `frontend/src/components/admin/recordings/RecordingAssuranceSummary.jsx`: render critical assurance counters.
- Create `frontend/src/components/admin/recordings/RecordingAssuranceTable.jsx`: render per-camera health reasons.
- Create or modify focused frontend tests under `frontend/src/components/admin/recordings/` and `frontend/src/pages/RecordingDashboard.test.jsx`.

---

### Task 1: Enforce Segment Identity In SQLite

**Files:**
- Create: `backend/database/migrations/zz_20260503_add_recording_segment_uniqueness.js`
- Modify: `backend/services/recordingSegmentRepository.js`
- Create: `backend/__tests__/recordingSegmentUniqueness.test.js`
- Modify: `backend/__tests__/recordingSegmentRepository.test.js`

- [ ] **Step 1: Write the failing repository uniqueness test**

Create `backend/__tests__/recordingSegmentUniqueness.test.js`:

```javascript
/**
 * Purpose: Verify recording segment identity is idempotent across repeated registration attempts.
 * Caller: Vitest backend suite before recording lifecycle hardening lands.
 * Deps: recordingSegmentRepository helpers and mocked SQLite connection helpers.
 * MainFuncs: duplicate-safe insert/update expectations.
 * SideEffects: None; repository contract tests only.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
    queryOne: queryOneMock,
}));

describe('recordingSegmentRepository uniqueness', () => {
    beforeEach(() => {
        executeMock.mockReset();
        queryMock.mockReset();
        queryOneMock.mockReset();
    });

    it('upserts by camera_id and filename instead of inserting duplicate rows', async () => {
        const repository = (await import('../services/recordingSegmentRepository.js')).default;

        executeMock.mockReturnValue({ changes: 1 });

        repository.upsertSegment({
            cameraId: 9,
            filename: '20260503_010000.mp4',
            startTime: '2026-05-03T01:00:00.000Z',
            endTime: '2026-05-03T01:10:00.000Z',
            fileSize: 2048,
            duration: 600,
            filePath: '/recordings/camera9/20260503_010000.mp4',
        });

        expect(executeMock).toHaveBeenCalledWith(
            expect.stringContaining('ON CONFLICT(camera_id, filename) DO UPDATE'),
            [
                9,
                '20260503_010000.mp4',
                '2026-05-03T01:00:00.000Z',
                '2026-05-03T01:10:00.000Z',
                2048,
                600,
                '/recordings/camera9/20260503_010000.mp4',
            ]
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd backend
npm test -- recordingSegmentUniqueness.test.js recordingSegmentRepository.test.js
```

Expected: FAIL because `upsertSegment` does not exist and the repository does not expose a conflict-safe write path.

- [ ] **Step 3: Add the migration skeleton**

Create `backend/database/migrations/zz_20260503_add_recording_segment_uniqueness.js`:

```javascript
// Purpose: Reconcile duplicate recording segments and enforce unique segment identity per camera.
// Caller: Backend migration runner after recording_segments table exists.
// Deps: better-sqlite3 database file and existing recording_segments schema.
// MainFuncs: deduplicate existing rows, create unique index on camera_id + filename.
// SideEffects: Deletes duplicate rows while preserving the newest/best row; creates a unique index.

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    const table = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = 'recording_segments'
    `).get();

    if (!table) {
        console.log('recording_segments table does not exist yet; skipping uniqueness migration');
        process.exit(0);
    }

    db.exec(`
        DELETE FROM recording_segments
        WHERE id IN (
            SELECT loser.id
            FROM recording_segments loser
            JOIN recording_segments winner
              ON winner.camera_id = loser.camera_id
             AND winner.filename = loser.filename
             AND (
                    winner.created_at > loser.created_at
                 OR (winner.created_at = loser.created_at AND winner.id > loser.id)
             )
        )
    `);

    db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_segments_camera_filename_unique
        ON recording_segments(camera_id, filename)
    `);

    console.log('Created unique index idx_recording_segments_camera_filename_unique');
} finally {
    db.close();
}
```

- [ ] **Step 4: Add the repository write path**

Append to `backend/services/recordingSegmentRepository.js`:

```javascript
    upsertSegment({
        cameraId,
        filename,
        startTime,
        endTime,
        fileSize,
        duration,
        filePath,
    }) {
        return execute(
            `INSERT INTO recording_segments
            (camera_id, filename, start_time, end_time, file_size, duration, file_path)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(camera_id, filename) DO UPDATE SET
                start_time = excluded.start_time,
                end_time = excluded.end_time,
                file_size = excluded.file_size,
                duration = excluded.duration,
                file_path = excluded.file_path`,
            [cameraId, filename, startTime, endTime, fileSize, duration, filePath]
        );
    }
```

- [ ] **Step 5: Run the focused tests**

Run:

```bash
cd backend
npm test -- recordingSegmentUniqueness.test.js recordingSegmentRepository.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status
git add backend/database/migrations/zz_20260503_add_recording_segment_uniqueness.js backend/services/recordingSegmentRepository.js backend/__tests__/recordingSegmentUniqueness.test.js backend/__tests__/recordingSegmentRepository.test.js
git commit -m "Fix: enforce unique recording segment identity"
git push
```

---

### Task 2: Remove Registration Race Windows From `recordingService`

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add a failing idempotent registration test**

Append to `backend/__tests__/recordingService.test.js`:

```javascript
it('registers the same segment idempotently when scanner and ffmpeg close detect it together', async () => {
    const { recordingService } = await import('../services/recordingService.js');
    const repository = (await import('../services/recordingSegmentRepository.js')).default;

    const upsertSpy = vi.spyOn(repository, 'upsertSegment').mockReturnValue({ changes: 1 });

    queryOneMock.mockImplementation((sql) => {
        if (sql.includes('FROM cameras')) {
            return {
                id: 5,
                name: 'Camera 5',
                enabled: 1,
                enable_recording: 1,
                recording_duration_hours: 5,
            };
        }

        return null;
    });

    recordingService.onSegmentCreated(5, '20260503_020000.mp4');
    recordingService.onSegmentCreated(5, '20260503_020000.mp4');

    await vi.advanceTimersByTimeAsync(3000);
    await Promise.resolve();

    expect(upsertSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused recording test**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "registers the same segment idempotently"
```

Expected: FAIL because current code still performs duplicate-sensitive inline `SELECT` plus `INSERT`.

- [ ] **Step 3: Replace the inline `SELECT` + `INSERT` block with repository upsert**

In `backend/services/recordingService.js`, replace the segment persistence section near the current `SELECT id FROM recording_segments` / `INSERT INTO recording_segments` block with:

```javascript
                recordingSegmentRepository.upsertSegment({
                    cameraId,
                    filename,
                    startTime: startTime.toISOString(),
                    endTime: endTime.toISOString(),
                    fileSize: finalSize,
                    duration: actualDuration,
                    filePath,
                });

                console.log(`✓ Segment saved: camera${cameraId}/${filename} (${(finalSize / 1024 / 1024).toFixed(2)} MB)`);
                cleanup();
                return;
```

- [ ] **Step 4: Delete the stale duplicate-precheck branch**

Remove the block that currently starts with:

```javascript
const existing = queryOne(
    'SELECT id FROM recording_segments WHERE camera_id = ? AND filename = ?',
    [cameraId, filename]
);
```

and ends after the `UPDATE recording_segments SET file_size = ? WHERE id = ?` branch. The repository write path is now the single persistence boundary.

- [ ] **Step 5: Run the broader recording tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingSegmentUniqueness.test.js recordingSegmentRepository.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: make recording segment registration idempotent"
git push
```

---

### Task 3: Standardize Recording Read Paths On `connectionPool.js`

**Files:**
- Modify: `backend/services/recordingPlaybackService.js`
- Modify: `backend/services/recordingAssuranceService.js`
- Modify: `backend/__tests__/recordingPlaybackService.test.js`
- Modify: `backend/__tests__/recordingAssuranceService.test.js`

- [ ] **Step 1: Add a failing contract assertion for connection source**

Append to `backend/__tests__/recordingPlaybackService.test.js`:

```javascript
it('uses connectionPool helpers instead of legacy database.js helpers', async () => {
    const moduleText = await import('node:fs/promises').then((fs) =>
        fs.readFile(new URL('../services/recordingPlaybackService.js', import.meta.url), 'utf8')
    );

    expect(moduleText).toContain(\"../database/connectionPool.js\");
    expect(moduleText).not.toContain(\"../database/database.js\");
});
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js recordingAssuranceService.test.js
```

Expected: FAIL because both services still import `../database/database.js`.

- [ ] **Step 3: Switch both services to pooled helpers**

Change the imports:

```javascript
import { query, queryOne, execute } from '../database/connectionPool.js';
```

for `backend/services/recordingPlaybackService.js`, and:

```javascript
import { query } from '../database/connectionPool.js';
```

for `backend/services/recordingAssuranceService.js`.

- [ ] **Step 4: Stop request-path mutation of `recording_segments.file_size`**

In `backend/services/recordingPlaybackService.js`, remove the branch:

```javascript
        if (Math.abs(stats.size - segment.file_size) > 1024 * 1024) {
            execute(
                'UPDATE recording_segments SET file_size = ? WHERE id = ?',
                [stats.size, segment.id]
            );
        }
```

and replace it with:

```javascript
        const resolvedFileSize = stats.size;

        return {
            segment: {
                ...segment,
                resolved_file_size: resolvedFileSize,
            },
            stats,
        };
```

This keeps stream requests read-only and moves any reconciliation into explicit background work later.

- [ ] **Step 5: Run the focused tests again**

Run:

```bash
cd backend
npm test -- recordingPlaybackService.test.js recordingAssuranceService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git status
git add backend/services/recordingPlaybackService.js backend/services/recordingAssuranceService.js backend/__tests__/recordingPlaybackService.test.js backend/__tests__/recordingAssuranceService.test.js
git commit -m "Refactor: standardize recording read services on connection pool"
git push
```

---

### Task 4: Extract Recording Scheduler Ownership

**Files:**
- Create: `backend/services/recordingScheduler.js`
- Modify: `backend/services/recordingService.js`
- Modify: `backend/server.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add the failing scheduler lifecycle test**

Append to `backend/__tests__/recordingService.test.js`:

```javascript
it('stops recording background timers on shutdown', async () => {
    const scheduler = await import('../services/recordingScheduler.js');

    const startSpy = vi.spyOn(scheduler.default, 'start').mockImplementation(() => {});
    const stopSpy = vi.spyOn(scheduler.default, 'stop').mockImplementation(() => {});

    const { recordingService } = await import('../services/recordingService.js');

    recordingService.attachScheduler(scheduler.default);
    recordingService.initializeBackgroundWork();
    await recordingService.shutdown();

    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(stopSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the focused lifecycle test**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "stops recording background timers on shutdown"
```

Expected: FAIL because there is no explicit scheduler boundary.

- [ ] **Step 3: Create the scheduler service skeleton**

Create `backend/services/recordingScheduler.js`:

```javascript
// Purpose: Own recording scanner and cleanup timer lifecycle outside the recording facade.
// Caller: backend/server.js startup and shutdown orchestration, recordingService compatibility hooks.
// Deps: injected callbacks for scanner, background cleanup, and scheduled cleanup work.
// MainFuncs: start, stop, isRunning.
// SideEffects: Starts and clears recursive timers for recording maintenance loops.

class RecordingScheduler {
    constructor() {
        this.timeouts = new Set();
        this.running = false;
    }

    start(tasks = {}) {
        if (this.running) {
            return;
        }

        this.running = true;
        tasks.onStart?.();
    }

    stop() {
        for (const timeoutId of this.timeouts) {
            clearTimeout(timeoutId);
        }
        this.timeouts.clear();
        this.running = false;
    }

    registerTimeout(timeoutId) {
        this.timeouts.add(timeoutId);
        return timeoutId;
    }

    isRunning() {
        return this.running;
    }
}

export default new RecordingScheduler();
```

- [ ] **Step 4: Add compatibility hooks to `recordingService`**

Add these methods to `backend/services/recordingService.js`:

```javascript
    attachScheduler(scheduler) {
        this.scheduler = scheduler;
    }

    initializeBackgroundWork() {
        this.scheduler?.start();
    }
```

and update `shutdown()` to call:

```javascript
        this.scheduler?.stop();
        this.isShuttingDown = true;
        return recordingProcessManager.shutdownAll('server_shutdown');
```

- [ ] **Step 5: Move startup ownership to `server.js`**

In `backend/server.js`, after `await recordingService.autoStartRecordings();`, initialize the scheduler explicitly:

```javascript
        recordingService.initializeBackgroundWork();
        console.log('[Recording] Background scheduler initialized');
```

and ensure the same singleton is attached near service setup:

```javascript
import recordingScheduler from './services/recordingScheduler.js';

recordingService.attachScheduler(recordingScheduler);
```

- [ ] **Step 6: Run lifecycle-focused tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingProcessManager.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status
git add backend/services/recordingScheduler.js backend/services/recordingService.js backend/server.js backend/__tests__/recordingService.test.js
git commit -m "Refactor: extract recording scheduler lifecycle"
git push
```

---

### Task 5: Scale Cleanup And Playback Query Boundaries

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/services/recordingSegmentRepository.js`
- Modify: `backend/services/recordingPlaybackService.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`
- Modify: `backend/__tests__/recordingPlaybackService.test.js`

- [ ] **Step 1: Add a failing bounded-orphan cleanup test**

Append to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
it('does not require loading every DB filename to process orphan cleanup', async () => {
    const repository = (await import('../services/recordingSegmentRepository.js')).default;
    const listSpy = vi.spyOn(repository, 'listFilenamesByCamera');

    const service = (await import('../services/recordingCleanupService.js')).createRecordingCleanupService({
        repository,
        recordingsBasePath: '/recordings',
        safeDelete: vi.fn(),
        isFileBeingProcessed: () => false,
        logger: console,
        fs: {
            access: vi.fn(),
            readdir: vi.fn().mockResolvedValue([]),
            stat: vi.fn(),
        },
    });

    await service.cleanupCamera({
        cameraId: 2,
        camera: { recording_duration_hours: 5 },
        nowMs: Date.parse('2026-05-03T10:00:00.000Z'),
    });

    expect(listSpy).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingPlaybackService.test.js
```

Expected: FAIL because orphan cleanup still calls `listFilenamesByCamera(cameraId)`.

- [ ] **Step 3: Introduce repository helpers for bounded membership checks**

In `backend/services/recordingSegmentRepository.js`, add:

```javascript
    findExistingFilenames({ cameraId, filenames }) {
        if (!filenames.length) {
            return [];
        }

        const placeholders = filenames.map(() => '?').join(', ');
        return query(
            `SELECT filename
            FROM recording_segments
            WHERE camera_id = ? AND filename IN (${placeholders})`,
            [cameraId, ...filenames]
        ).map((row) => row.filename);
    }
```

- [ ] **Step 4: Change cleanup to use per-directory bounded membership**

In `backend/services/recordingCleanupService.js`, replace:

```javascript
        const filenames = await fs.readdir(cameraDir);
        const dbFilenames = new Set(repository.listFilenamesByCamera(cameraId));
```

with:

```javascript
        const filenames = (await fs.readdir(cameraDir))
            .filter((filename) => isSafeRecordingFilename(filename));
        const dbFilenames = new Set(repository.findExistingFilenames({
            cameraId,
            filenames,
        }));
```

- [ ] **Step 5: Keep playback preview queries bounded**

In `backend/services/recordingPlaybackService.js`, ensure preview gating continues to use:

```javascript
            const previewSegments = recordingSegmentRepository.findPlaybackSegments({
                cameraId,
                order: 'latest',
                limit: getPreviewSegmentLimit(access.previewMinutes),
                returnAscending: true,
            });
```

and add/adjust tests so stream-by-filename checks do not use a full segment list in memory.

- [ ] **Step 6: Run the focused tests**

Run:

```bash
cd backend
npm test -- recordingCleanupService.test.js recordingPlaybackService.test.js recordingSegmentRepository.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status
git add backend/services/recordingCleanupService.js backend/services/recordingSegmentRepository.js backend/services/recordingPlaybackService.js backend/__tests__/recordingCleanupService.test.js backend/__tests__/recordingPlaybackService.test.js backend/__tests__/recordingSegmentRepository.test.js
git commit -m "Fix: bound recording cleanup and playback queries"
git push
```

---

### Task 6: Surface Recording Assurance In The Admin UI

**Files:**
- Modify: `frontend/src/services/recordingService.js`
- Modify: `frontend/src/hooks/admin/useRecordingDashboardData.js`
- Modify: `frontend/src/pages/RecordingDashboard.jsx`
- Create: `frontend/src/components/admin/recordings/RecordingAssuranceSummary.jsx`
- Create: `frontend/src/components/admin/recordings/RecordingAssuranceTable.jsx`
- Modify: `frontend/src/pages/RecordingDashboard.test.jsx` or `frontend/src/pages/RecordingDashboard.test.jsx`

- [ ] **Step 1: Add the failing frontend service test or page assertion**

Append to `frontend/src/pages/RecordingDashboard.test.jsx`:

```javascript
it('renders assurance counters when backend returns stale and missing segment warnings', async () => {
    vi.mock('../services/recordingService', () => ({
        default: {
            getRecordingsOverview: vi.fn().mockResolvedValue({ success: true, data: { cameras: [] } }),
            getRestartLogs: vi.fn().mockResolvedValue({ success: true, data: [] }),
            getRecordingAssurance: vi.fn().mockResolvedValue({
                success: true,
                data: {
                    summary: {
                        total_monitored: 3,
                        healthy: 1,
                        warning: 1,
                        critical: 1,
                        recording_down: 1,
                        stale_segments: 1,
                        missing_segments: 1,
                        recent_gap_cameras: 1,
                    },
                    cameras: [],
                },
            }),
        },
    }));
});
```

- [ ] **Step 2: Run the focused frontend test**

Run:

```bash
cd frontend
npm test -- RecordingDashboard.test.jsx
```

Expected: FAIL because the dashboard hook does not request assurance data.

- [ ] **Step 3: Add the assurance API client**

Append to `frontend/src/services/recordingService.js`:

```javascript
export const getRecordingAssurance = async (policy = REQUEST_POLICY.BLOCKING, config = {}) => {
    const response = await apiClient.get('/api/recordings/assurance', getRequestPolicyConfig(policy, config));
    return response.data;
};
```

and expose it in the default export.

- [ ] **Step 4: Extend the dashboard hook to load assurance**

In `frontend/src/hooks/admin/useRecordingDashboardData.js`, update the request bundle:

```javascript
            const [recordingsRes, restartsRes, assuranceRes] = await Promise.all([
                recordingService.getRecordingsOverview(policy),
                recordingService.getRestartLogs(null, 50, policy),
                recordingService.getRecordingAssurance(policy),
            ]);
```

Add local state:

```javascript
    const [assurance, setAssurance] = useState(null);
```

and persist successful assurance data with the same background-refresh semantics as overview/restart logs.

- [ ] **Step 5: Render assurance widgets in the page**

Create `frontend/src/components/admin/recordings/RecordingAssuranceSummary.jsx`:

```jsx
/*
Purpose: Render top-level recording assurance counters for stale, missing, and down recording states.
Caller: RecordingDashboard page after assurance data loads.
Deps: assurance summary payload and existing Tailwind admin card style.
MainFuncs: RecordingAssuranceSummary.
SideEffects: None; presentational only.
*/

export default function RecordingAssuranceSummary({ summary }) {
    if (!summary) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 dark:border-red-500/20 dark:bg-red-500/10">
                <p className="text-sm font-medium text-red-700 dark:text-red-300">Recording Down</p>
                <p className="mt-2 text-2xl font-bold text-red-800 dark:text-red-100">{summary.recording_down}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300">Stale Segments</p>
                <p className="mt-2 text-2xl font-bold text-amber-800 dark:text-amber-100">{summary.stale_segments}</p>
            </div>
            <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4 dark:border-orange-500/20 dark:bg-orange-500/10">
                <p className="text-sm font-medium text-orange-700 dark:text-orange-300">Missing Segments</p>
                <p className="mt-2 text-2xl font-bold text-orange-800 dark:text-orange-100">{summary.missing_segments}</p>
            </div>
            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-500/20 dark:bg-sky-500/10">
                <p className="text-sm font-medium text-sky-700 dark:text-sky-300">Recent Gaps</p>
                <p className="mt-2 text-2xl font-bold text-sky-800 dark:text-sky-100">{summary.recent_gap_cameras}</p>
            </div>
        </div>
    );
}
```

Create `frontend/src/components/admin/recordings/RecordingAssuranceTable.jsx` as a simple per-camera list of `health`, `reasons`, and `seconds_since_latest_end`, then render both components in `frontend/src/pages/RecordingDashboard.jsx` below the summary cards.

- [ ] **Step 6: Run the focused frontend verification**

Run:

```bash
cd frontend
npm test -- RecordingDashboard.test.jsx
npm run build
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git status
git add frontend/src/services/recordingService.js frontend/src/hooks/admin/useRecordingDashboardData.js frontend/src/pages/RecordingDashboard.jsx frontend/src/components/admin/recordings/RecordingAssuranceSummary.jsx frontend/src/components/admin/recordings/RecordingAssuranceTable.jsx frontend/src/pages/RecordingDashboard.test.jsx
git commit -m "Add: expose recording assurance in dashboard"
git push
```

---

### Task 7: Clean Up Recording Documentation Boundaries

**Files:**
- Modify: `backend/services/.module_map.md`
- Modify: `docs/superpowers/plans/2026-05-01-recording-lifecycle-hardening.md`
- Modify: `docs/superpowers/plans/2026-05-02-recording-cleanup-refactor.md`
- Modify: `docs/superpowers/plans/2026-05-02-recording-retention-hardening.md`

- [ ] **Step 1: Update module ownership docs**

In `backend/services/.module_map.md`, update the recording section to include:

```markdown
- `recordingScheduler.js`: owns scanner/background/scheduled cleanup timer lifecycle; `recordingService.js` must not own raw timer handles.
- `recordingSegmentRepository.js`: owns duplicate-safe segment persistence through `(camera_id, filename)` uniqueness.
- `recordingAssuranceService.js`: read-only assurance snapshot and operator-facing degradation summary.
```

- [ ] **Step 2: Add a short “superseded by priority plan” note to the older plans**

At the top of each existing plan, append a note like:

```markdown
> Execution order note: this plan is still valid, but cross-plan priority and missing integrity work are now coordinated by `docs/superpowers/plans/2026-05-03-recording-stabilization-priority-plan.md`.
```

- [ ] **Step 3: Verify docs-only diff**

Run:

```bash
git diff -- backend/services/.module_map.md docs/superpowers/plans/2026-05-01-recording-lifecycle-hardening.md docs/superpowers/plans/2026-05-02-recording-cleanup-refactor.md docs/superpowers/plans/2026-05-02-recording-retention-hardening.md
```

Expected: only documentation changes.

- [ ] **Step 4: Commit**

```bash
git status
git add backend/services/.module_map.md docs/superpowers/plans/2026-05-01-recording-lifecycle-hardening.md docs/superpowers/plans/2026-05-02-recording-cleanup-refactor.md docs/superpowers/plans/2026-05-02-recording-retention-hardening.md docs/superpowers/plans/2026-05-03-recording-stabilization-priority-plan.md
git commit -m "Add: recording stabilization priority plan"
git push
```

---

## Verification Checklist

Run these gates after all tasks:

```bash
cd backend
npm run migrate
npm test -- recordingService.test.js recordingProcessManager.test.js recordingCleanupService.test.js recordingPlaybackService.test.js recordingAssuranceService.test.js recordingSegmentRepository.test.js recordingSegmentUniqueness.test.js

cd ../frontend
npm test -- RecordingDashboard.test.jsx
npm run build
```

Expected final result:

- `recording_segments` is duplicate-safe by schema, not just by in-memory guards.
- Recording shutdown stops background timer ownership cleanly.
- Cleanup and playback queries remain bounded.
- Playback/assurance read paths use the same SQLite access strategy as the rest of recording.
- Admins can see stale, missing, gap, and down states without reading backend logs.

## Self-Review

- Spec coverage:
  - Lifecycle hardening is covered by Task 4 and backend verification.
  - Cleanup refactor/retention hardening is covered by Tasks 1, 2, and 5.
  - Missed project-wide gaps from the analysis are covered by Tasks 1, 3, 4, 6, and 7.
- Placeholder scan:
  - No `TODO`, `TBD`, or “implement later” placeholders remain.
  - Each task contains concrete file paths, code snippets, commands, and expected outcomes.
- Type consistency:
  - Repository write method is consistently named `upsertSegment`.
  - Scheduler boundary uses `attachScheduler()` and `initializeBackgroundWork()` consistently across service/server tasks.

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-recording-stabilization-priority-plan.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
