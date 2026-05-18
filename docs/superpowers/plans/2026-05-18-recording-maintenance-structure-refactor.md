<!--
Purpose: Implementation plan for restructuring recording maintenance from recording start through cleanup.
Caller: Agents executing the recording/cleanup structural hardening refactor after the May 18 storage incident.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md.
MainFuncs: Defines phased TDD refactor tasks, target files, verification, and commit flow.
SideEffects: Documentation only.
-->

# Recording Maintenance Structure Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording maintenance from FFmpeg segment detection through normal cleanup and emergency cleanup small, testable, observable, and safe to maintain without changing playback or retention behavior unexpectedly.

**Architecture:** Keep `recordingService.js` as the public compatibility facade, but move maintenance loops, emergency disk decisions, and background orphan reconciliation into focused services with injected dependencies. Destructive operations must still pass through `recordingCleanupService.js`, `recordingRetentionPolicy.js`, and `recordingFileOperationService.js`; the refactor adds observability and circuit-breaker policy after behavior is covered by tests.

**Tech Stack:** Node.js 20 ES modules, Fastify backend service layer, SQLite/better-sqlite3 migrations, Vitest.

---

## Position

Yes, this refactor is worth doing before adding more recording features. The current recording core is safer than before, but `backend/services/recordingService.js` is still about 1181 lines and still owns lifecycle, scheduler callbacks, background orphan cleanup, emergency disk cleanup, status reads, and auto-start behavior. That makes maintenance risky because a small cleanup change can accidentally affect FFmpeg lifecycle or recovery.

The zero-bug target here means: no behavior-preserving extraction lands without characterization tests, no destructive path bypasses the shared safe-delete boundary, and no emergency cleanup decision is invisible to operators.

## Non-Goals

- Do not change public API routes or frontend playback behavior.
- Do not change default retention duration semantics.
- Do not rewrite `recordingService.js` in one commit.
- Do not delete final `.mp4` filesystem orphans directly; they still go through recovery/finalizer first.
- Do not make PM2, OS, or deployment script changes in this refactor.

## Target File Structure

- Create `backend/services/recordingMaintenanceStateRepository.js`: persist last maintenance run state and event history.
- Create `backend/services/recordingDiskSpaceService.js`: read free disk bytes behind an injectable boundary.
- Create `backend/services/recordingEmergencyDiskService.js`: own low-disk decision flow and call `recordingCleanupService.emergencyCleanup()`.
- Create `backend/services/recordingBackgroundCleanupService.js`: own slow orphan queue building and processing.
- Create `backend/services/recordingMaintenanceService.js`: own scheduled cleanup orchestration and state recording.
- Modify `backend/services/recordingService.js`: delegate maintenance methods while preserving method names.
- Modify `backend/services/recordingAssuranceService.js`: expose maintenance health snapshot for operator diagnostics.
- Create `backend/database/migrations/zz_20260518_add_recording_maintenance_state.js`: add maintenance state/history tables and indexes.
- Modify `backend/services/.module_map.md`: document new service ownership and destructive cleanup invariant.
- Add tests:
  - `backend/__tests__/recordingMaintenanceStateRepository.test.js`
  - `backend/__tests__/recordingDiskSpaceService.test.js`
  - `backend/__tests__/recordingEmergencyDiskService.test.js`
  - `backend/__tests__/recordingBackgroundCleanupService.test.js`
  - `backend/__tests__/recordingMaintenanceService.test.js`
  - Update `backend/__tests__/recordingService.test.js`
  - Update `backend/__tests__/recordingAssuranceService.test.js`

## Stable Interfaces

The facade must keep these method names during the refactor:

```javascript
recordingService.cleanupOldSegments(cameraId)
recordingService.cleanupTempFiles()
recordingService.startBackgroundCleanup(scheduleTimeout)
recordingService.startScheduledCleanup(scheduleTimeout)
recordingService.emergencyDiskSpaceCheck()
recordingService.startSegmentScanner(scheduleTimeout)
recordingService.start()
recordingService.shutdown()
```

The new maintenance result shape must be stable:

```javascript
export const EMPTY_RECORDING_MAINTENANCE_RESULT = {
    status: 'ok',
    cleanupRuns: 0,
    emergencyRuns: 0,
    deleted: 0,
    deletedBytes: 0,
    orphanRecoveriesQueued: 0,
    processingSkipped: 0,
    unsafeSkipped: 0,
    failed: 0,
    errorMessage: null,
};
```

---

## Tasks

### Task 1: Characterization Tests Before Moving Code

**Files:**
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add characterization tests for existing facade methods**

Add these tests near the existing emergency cleanup tests:

```javascript
it('keeps recording maintenance facade methods available during refactor', async () => {
    const { recordingService } = await import('../services/recordingService.js');

    expect(typeof recordingService.cleanupOldSegments).toBe('function');
    expect(typeof recordingService.cleanupTempFiles).toBe('function');
    expect(typeof recordingService.startBackgroundCleanup).toBe('function');
    expect(typeof recordingService.startScheduledCleanup).toBe('function');
    expect(typeof recordingService.emergencyDiskSpaceCheck).toBe('function');
});

it('scheduled cleanup still runs per-camera cleanup before emergency disk check', async () => {
    const { recordingService } = await import('../services/recordingService.js');
    const scheduledCallbacks = [];
    const scheduleTimeout = vi.fn((callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
    });
    const cleanupSpy = vi.spyOn(recordingService, 'cleanupOldSegments').mockResolvedValue({ deleted: 0 });
    const emergencySpy = vi.spyOn(recordingService, 'emergencyDiskSpaceCheck').mockResolvedValue(undefined);

    queryMock.mockReturnValue([{ id: 7 }, { id: 8 }]);
    fsPromisesMock.access.mockRejectedValueOnce(new Error('no recordings dir'));

    recordingService.startScheduledCleanup(scheduleTimeout);
    await scheduledCallbacks[0]();

    expect(cleanupSpy).toHaveBeenCalledWith(7);
    expect(cleanupSpy).toHaveBeenCalledWith(8);
    expect(emergencySpy).toHaveBeenCalledTimes(1);
    expect(scheduleTimeout).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run the characterization tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "recording maintenance facade|scheduled cleanup still runs"
```

Expected: PASS before any extraction.

- [ ] **Step 3: Commit characterization tests**

Run:

```bash
git status --short
git add backend/__tests__/recordingService.test.js
git commit -m "Fix: characterize recording maintenance facade"
```

### Task 2: Add Maintenance State Tables

**Files:**
- Create: `backend/database/migrations/zz_20260518_add_recording_maintenance_state.js`
- Create: `backend/services/recordingMaintenanceStateRepository.js`
- Create: `backend/__tests__/recordingMaintenanceStateRepository.test.js`
- Modify: `backend/database/migrations/run_all_migrations.js`

- [ ] **Step 1: Add repository tests first**

Create `backend/__tests__/recordingMaintenanceStateRepository.test.js`:

```javascript
/**
 * Purpose: Verify recording maintenance state persistence for cleanup observability.
 * Caller: Vitest backend suite.
 * Deps: recordingMaintenanceStateRepository, connectionPool mocks.
 * MainFuncs: upsertRunState, insertRunEvent, getLatestState.
 * SideEffects: None; DB helpers are mocked.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    queryOne: queryOneMock,
}));

const repository = (await import('../services/recordingMaintenanceStateRepository.js')).default;

describe('recordingMaintenanceStateRepository', () => {
    beforeEach(() => {
        executeMock.mockReset();
        queryOneMock.mockReset();
    });

    it('upserts latest run state by maintenance type', () => {
        repository.upsertRunState({
            maintenanceType: 'scheduled_cleanup',
            status: 'ok',
            startedAt: '2026-05-18T10:00:00.000Z',
            finishedAt: '2026-05-18T10:00:02.000Z',
            deleted: 2,
            deletedBytes: 4096,
            errorMessage: null,
        });

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT(maintenance_type) DO UPDATE'), [
            'scheduled_cleanup',
            'ok',
            '2026-05-18T10:00:00.000Z',
            '2026-05-18T10:00:02.000Z',
            2,
            4096,
            null,
        ]);
    });

    it('reads latest state for assurance diagnostics', () => {
        queryOneMock.mockReturnValue({ maintenance_type: 'emergency_cleanup', status: 'ok' });

        expect(repository.getLatestState('emergency_cleanup')).toEqual({
            maintenance_type: 'emergency_cleanup',
            status: 'ok',
        });
        expect(queryOneMock).toHaveBeenCalledWith(expect.stringContaining('FROM recording_maintenance_state'), ['emergency_cleanup']);
    });
});
```

- [ ] **Step 2: Run repository tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingMaintenanceStateRepository.test.js
```

Expected: FAIL because the repository does not exist.

- [ ] **Step 3: Create migration**

Create `backend/database/migrations/zz_20260518_add_recording_maintenance_state.js`:

```javascript
// Purpose: Add recording maintenance state and event history tables.
// Caller: Backend migration runner after recording cleanup hardening migrations.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates recording_maintenance_state and recording_maintenance_events tables plus indexes.

const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_maintenance_state (
            maintenance_type TEXT PRIMARY KEY,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_bytes INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS recording_maintenance_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            maintenance_type TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT,
            finished_at TEXT,
            deleted INTEGER NOT NULL DEFAULT 0,
            deleted_bytes INTEGER NOT NULL DEFAULT 0,
            error_message TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_recording_maintenance_events_type_created
            ON recording_maintenance_events(maintenance_type, created_at DESC);
    `);

    console.log('Recording maintenance state migration completed');
} finally {
    db.close();
}
```

Modify `backend/database/migrations/run_all_migrations.js` legacy list to include:

```javascript
'zz_20260518_add_recording_maintenance_state.js',
```

- [ ] **Step 4: Create repository**

Create `backend/services/recordingMaintenanceStateRepository.js`:

```javascript
// Purpose: Persist recording maintenance run status for cleanup observability.
// Caller: recordingMaintenanceService, recordingEmergencyDiskService, recordingAssuranceService.
// Deps: database connectionPool helpers.
// MainFuncs: upsertRunState, insertRunEvent, getLatestState.
// SideEffects: Writes and reads recording_maintenance_state and recording_maintenance_events.

import { execute, queryOne } from '../database/connectionPool.js';

class RecordingMaintenanceStateRepository {
    upsertRunState({ maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage }) {
        return execute(
            `INSERT INTO recording_maintenance_state
            (maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(maintenance_type) DO UPDATE SET
                status = excluded.status,
                started_at = excluded.started_at,
                finished_at = excluded.finished_at,
                deleted = excluded.deleted,
                deleted_bytes = excluded.deleted_bytes,
                error_message = excluded.error_message,
                updated_at = CURRENT_TIMESTAMP`,
            [maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage]
        );
    }

    insertRunEvent({ maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage }) {
        return execute(
            `INSERT INTO recording_maintenance_events
            (maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [maintenanceType, status, startedAt, finishedAt, deleted, deletedBytes, errorMessage]
        );
    }

    getLatestState(maintenanceType) {
        return queryOne(
            `SELECT maintenance_type, status, started_at, finished_at, deleted, deleted_bytes, error_message, updated_at
            FROM recording_maintenance_state
            WHERE maintenance_type = ?`,
            [maintenanceType]
        );
    }
}

export default new RecordingMaintenanceStateRepository();
```

- [ ] **Step 5: Run migration and tests**

Run:

```bash
cd backend
npm run migrate
npm test -- recordingMaintenanceStateRepository.test.js
```

Expected: migration PASS, tests PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add backend/database/migrations/zz_20260518_add_recording_maintenance_state.js backend/database/migrations/run_all_migrations.js backend/services/recordingMaintenanceStateRepository.js backend/__tests__/recordingMaintenanceStateRepository.test.js
git commit -m "Fix: add recording maintenance state repository"
```

### Task 3: Extract Disk Free-Space Reader

**Files:**
- Create: `backend/services/recordingDiskSpaceService.js`
- Create: `backend/__tests__/recordingDiskSpaceService.test.js`

- [ ] **Step 1: Add disk service tests**

Create `backend/__tests__/recordingDiskSpaceService.test.js`:

```javascript
/**
 * Purpose: Verify recording disk free-space reader behavior.
 * Caller: Vitest backend suite.
 * Deps: recordingDiskSpaceService with injected exec.
 * MainFuncs: createRecordingDiskSpaceService.
 * SideEffects: None; shell exec is mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRecordingDiskSpaceService } from '../services/recordingDiskSpaceService.js';

describe('recordingDiskSpaceService', () => {
    it('reads Windows drive free bytes from the recording base path', async () => {
        const exec = vi.fn(async () => ({ stdout: '2147483648\n' }));
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('C:\\recordings')).resolves.toBe(2147483648);
        expect(exec).toHaveBeenCalledWith(
            'powershell -Command "(Get-PSDrive C).Free"',
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('falls back to df when PowerShell fails', async () => {
        const exec = vi.fn()
            .mockRejectedValueOnce(new Error('powershell unavailable'))
            .mockResolvedValueOnce({ stdout: '999\n' });
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('/var/recordings')).resolves.toBe(999);
        expect(exec).toHaveBeenNthCalledWith(
            2,
            'df -B1 "/var/recordings" | tail -1 | awk \'{print $4}\'',
            { encoding: 'utf8', timeout: 5000 }
        );
    });

    it('returns null when free bytes cannot be determined', async () => {
        const exec = vi.fn().mockRejectedValue(new Error('no disk command'));
        const service = createRecordingDiskSpaceService({ exec });

        await expect(service.getFreeBytes('/recordings')).resolves.toBe(null);
    });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
cd backend
npm test -- recordingDiskSpaceService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Create disk service**

Create `backend/services/recordingDiskSpaceService.js`:

```javascript
// Purpose: Read free disk bytes for recording storage behind an injectable boundary.
// Caller: recordingEmergencyDiskService.
// Deps: child_process exec via injected promise function.
// MainFuncs: createRecordingDiskSpaceService, getFreeBytes.
// SideEffects: Executes OS disk-space commands.

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const defaultExec = promisify(execCallback);

export function createRecordingDiskSpaceService({ exec = defaultExec } = {}) {
    async function getFreeBytes(recordingsBasePath) {
        const drive = String(recordingsBasePath || '').charAt(0);
        if (/^[A-Za-z]$/.test(drive)) {
            try {
                const { stdout } = await exec(
                    `powershell -Command "(Get-PSDrive ${drive}).Free"`,
                    { encoding: 'utf8', timeout: 5000 }
                );
                const value = Number.parseInt(String(stdout).trim(), 10);
                if (Number.isFinite(value)) {
                    return value;
                }
            } catch {
                // Fall through to POSIX df for non-Windows runtimes.
            }
        }

        try {
            const { stdout } = await exec(
                `df -B1 "${recordingsBasePath}" | tail -1 | awk '{print $4}'`,
                { encoding: 'utf8', timeout: 5000 }
            );
            const value = Number.parseInt(String(stdout).trim(), 10);
            return Number.isFinite(value) ? value : null;
        } catch {
            return null;
        }
    }

    return { getFreeBytes };
}

export default createRecordingDiskSpaceService();
```

- [ ] **Step 4: Run disk service tests**

Run:

```bash
cd backend
npm test -- recordingDiskSpaceService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add backend/services/recordingDiskSpaceService.js backend/__tests__/recordingDiskSpaceService.test.js
git commit -m "Fix: extract recording disk space reader"
```

### Task 4: Extract Emergency Disk Cleanup

**Files:**
- Create: `backend/services/recordingEmergencyDiskService.js`
- Create: `backend/__tests__/recordingEmergencyDiskService.test.js`
- Modify: `backend/services/recordingService.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add emergency service tests**

Create `backend/__tests__/recordingEmergencyDiskService.test.js`:

```javascript
/**
 * Purpose: Verify emergency recording disk cleanup orchestration.
 * Caller: Vitest backend suite.
 * Deps: recordingEmergencyDiskService with injected disk reader, cleanup service, filesystem, and repository callbacks.
 * MainFuncs: createRecordingEmergencyDiskService.
 * SideEffects: None; dependencies are mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { createRecordingEmergencyDiskService } from '../services/recordingEmergencyDiskService.js';

function createService(overrides = {}) {
    const cleanupService = {
        emergencyCleanup: vi.fn(async () => ({ deleted: 1, deletedBytes: 4096 })),
    };
    const diskSpaceService = {
        getFreeBytes: vi.fn(async () => 100),
    };
    const fs = {
        access: vi.fn(async () => undefined),
        readdir: vi.fn(async (targetPath) => {
            if (String(targetPath).endsWith('recordings')) return ['camera7'];
            return ['20260518_090000.mp4', '20260518_090100.temp.mp4'];
        }),
        stat: vi.fn(async (targetPath) => ({
            isDirectory: () => String(targetPath).endsWith('camera7'),
            mtimeMs: Date.parse('2026-05-18T02:00:00.000Z'),
            size: 1024,
        })),
    };
    const safeDelete = vi.fn(async () => ({ success: true, size: 1024 }));
    const onRecoverOrphan = vi.fn();

    return {
        cleanupService,
        diskSpaceService,
        fs,
        safeDelete,
        onRecoverOrphan,
        service: createRecordingEmergencyDiskService({
            recordingsBasePath: join('C:\\', 'recordings'),
            cleanupService,
            diskSpaceService,
            fs,
            safeDelete,
            getCameraRetentionHours: () => 1,
            onRecoverOrphan,
            logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
            now: () => Date.parse('2026-05-18T10:00:00.000Z'),
            ...overrides,
        }),
    };
}

describe('recordingEmergencyDiskService', () => {
    it('skips cleanup when disk space is above threshold', async () => {
        const { service, diskSpaceService, cleanupService } = createService({
            diskSpaceService: { getFreeBytes: vi.fn(async () => 3 * 1024 * 1024 * 1024) },
        });

        const result = await service.runEmergencyCheck();

        expect(result.status).toBe('skipped_enough_space');
        expect(diskSpaceService.getFreeBytes).toBeDefined();
        expect(cleanupService.emergencyCleanup).not.toHaveBeenCalled();
    });

    it('uses cleanupService retention bypass before filesystem fallback', async () => {
        const { service, cleanupService } = createService();

        const result = await service.runEmergencyCheck();

        expect(cleanupService.emergencyCleanup).toHaveBeenCalledWith(expect.objectContaining({
            freeBytes: 100,
            targetFreeBytes: 2 * 1024 * 1024 * 1024,
            batchLimit: 200,
            allowRetentionBypass: true,
        }));
        expect(result.deleted).toBeGreaterThanOrEqual(1);
        expect(result.deletedBytes).toBeGreaterThanOrEqual(4096);
    });

    it('queues final filesystem orphans for recovery instead of deleting them directly', async () => {
        const { service, onRecoverOrphan, safeDelete } = createService({
            cleanupService: { emergencyCleanup: vi.fn(async () => ({ deleted: 0, deletedBytes: 0 })) },
        });

        await service.runEmergencyCheck();

        expect(onRecoverOrphan).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 7,
            filename: '20260518_090000.mp4',
        }));
        expect(safeDelete).not.toHaveBeenCalledWith(expect.objectContaining({
            filename: '20260518_090000.mp4',
        }));
    });
});
```

- [ ] **Step 2: Run emergency service tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingEmergencyDiskService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Create emergency service**

Create `backend/services/recordingEmergencyDiskService.js` with this public interface:

```javascript
// Purpose: Orchestrate low-disk recording cleanup without coupling it to the recording facade.
// Caller: recordingMaintenanceService and recordingService compatibility method.
// Deps: recording cleanup service, disk space service, retention policy, segment file policy, file operations.
// MainFuncs: createRecordingEmergencyDiskService, runEmergencyCheck.
// SideEffects: May delete safe temp files, queue final orphan recovery, and delete DB-registered segments through cleanupService.

import { join } from 'path';
import { canDeleteRecordingFile, computeRetentionWindow } from './recordingRetentionPolicy.js';
import { isFinalSegmentFilename } from './recordingSegmentFilePolicy.js';

export const EMERGENCY_DISK_THRESHOLD_BYTES = 1 * 1024 * 1024 * 1024;
export const EMERGENCY_DISK_TARGET_BYTES = 2 * 1024 * 1024 * 1024;

export function createRecordingEmergencyDiskService({
    recordingsBasePath,
    cleanupService,
    diskSpaceService,
    fs,
    safeDelete,
    getCameraRetentionHours,
    onRecoverOrphan,
    logger = console,
    now = Date.now,
} = {}) {
    async function runEmergencyCheck() {
        const freeBytes = await diskSpaceService.getFreeBytes(recordingsBasePath);
        if (!Number.isFinite(freeBytes)) {
            return { status: 'skipped_unknown_disk', deleted: 0, deletedBytes: 0 };
        }

        const freeGB = (freeBytes / (1024 * 1024 * 1024)).toFixed(2);
        logger.log?.(`[DiskCheck] Free disk space: ${freeGB}GB`);

        if (freeBytes > EMERGENCY_DISK_THRESHOLD_BYTES) {
            return { status: 'skipped_enough_space', freeBytes, deleted: 0, deletedBytes: 0 };
        }

        logger.warn?.(`[DiskCheck] LOW DISK SPACE: ${freeGB}GB free. Starting emergency cleanup...`);
        const primaryResult = await cleanupService.emergencyCleanup({
            freeBytes,
            targetFreeBytes: EMERGENCY_DISK_TARGET_BYTES,
            batchLimit: 200,
            allowRetentionBypass: true,
            getCameraRetentionHours,
        });

        let deleted = primaryResult.deleted || 0;
        let deletedBytes = primaryResult.deletedBytes || 0;

        if ((freeBytes + deletedBytes) < EMERGENCY_DISK_TARGET_BYTES) {
            const fallbackResult = await cleanupFilesystemFallback({ freeBytes, deletedBytes });
            deleted += fallbackResult.deleted;
            deletedBytes += fallbackResult.deletedBytes;
        }

        if (deleted > 0) {
            logger.warn?.(`[DiskCheck] Emergency cleanup: deleted ${deleted} files, freed ${(deletedBytes / 1024 / 1024).toFixed(2)}MB`);
        }

        return { status: 'ok', freeBytes, deleted, deletedBytes };
    }

    async function cleanupFilesystemFallback({ freeBytes, deletedBytes }) {
        const result = { deleted: 0, deletedBytes: 0 };
        try {
            await fs.access(recordingsBasePath);
        } catch {
            return result;
        }

        const cameraDirs = await fs.readdir(recordingsBasePath);
        for (const dir of cameraDirs) {
            if ((freeBytes + deletedBytes + result.deletedBytes) > EMERGENCY_DISK_TARGET_BYTES) break;
            const cameraIdMatch = String(dir).match(/^camera(\d+)$/);
            if (!cameraIdMatch) continue;

            const cameraId = Number.parseInt(cameraIdMatch[1], 10);
            const fullDirPath = join(recordingsBasePath, dir);
            let stats;
            try {
                stats = await fs.stat(fullDirPath);
            } catch {
                continue;
            }
            if (!stats.isDirectory()) continue;

            const files = await listDeletionCandidates({ cameraId, fullDirPath });
            for (const file of files) {
                if ((freeBytes + deletedBytes + result.deletedBytes) > EMERGENCY_DISK_TARGET_BYTES) break;
                if (isFinalSegmentFilename(file.name)) {
                    await onRecoverOrphan({ cameraId, filename: file.name, filePath: file.path, sourceType: 'final_orphan' });
                    continue;
                }

                const deleteResult = await safeDelete({
                    cameraId,
                    filename: file.name,
                    filePath: file.path,
                    reason: 'emergency_filesystem_cleanup',
                });
                if (deleteResult.success) {
                    result.deleted++;
                    result.deletedBytes += deleteResult.size || 0;
                }
            }
        }

        return result;
    }

    async function listDeletionCandidates({ cameraId, fullDirPath }) {
        const allFiles = await fs.readdir(fullDirPath);
        const nowMs = now();
        const retentionWindow = computeRetentionWindow({
            retentionHours: getCameraRetentionHours(cameraId),
            nowMs,
        });
        const files = [];

        for (const filename of allFiles) {
            if (!/^\d{8}_\d{6}\.mp4$/.test(filename) && !filename.includes('.remux.mp4') && !filename.includes('.temp.mp4')) {
                continue;
            }

            const filePath = join(fullDirPath, filename);
            try {
                const stats = await fs.stat(filePath);
                const deletePolicy = canDeleteRecordingFile({
                    filename,
                    fileMtimeMs: stats.mtimeMs,
                    retentionWindow,
                    nowMs,
                });
                if (deletePolicy.allowed) {
                    files.push({ name: filename, path: filePath, mtime: stats.mtimeMs, size: stats.size });
                }
            } catch {
                logger.error?.(`[DiskCheck] Failed reading emergency candidate ${filePath}`);
            }
        }

        return files.sort((a, b) => a.mtime - b.mtime);
    }

    return { runEmergencyCheck };
}
```

- [ ] **Step 4: Wire facade method as delegation**

In `backend/services/recordingService.js`, construct the emergency service near the existing `cleanupService` construction and replace `emergencyDiskSpaceCheck()` body with:

```javascript
    async emergencyDiskSpaceCheck() {
        return emergencyDiskService.runEmergencyCheck();
    }
```

The injected callbacks must be:

```javascript
const emergencyDiskService = createRecordingEmergencyDiskService({
    recordingsBasePath: RECORDINGS_BASE_PATH,
    cleanupService,
    diskSpaceService: recordingDiskSpaceService,
    fs: fsPromises,
    safeDelete: recordingFileOperationService.deleteFileSafely,
    getCameraRetentionHours: (cameraId) => {
        const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
        return camera?.recording_duration_hours;
    },
    onRecoverOrphan: ({ cameraId, filename }) => recordingService.onSegmentCreated(cameraId, filename),
    logger: console,
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingEmergencyDiskService.test.js recordingService.test.js recordingCleanupService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add backend/services/recordingEmergencyDiskService.js backend/services/recordingService.js backend/__tests__/recordingEmergencyDiskService.test.js backend/__tests__/recordingService.test.js
git commit -m "Fix: extract recording emergency disk cleanup"
```

### Task 5: Extract Background Orphan Cleanup Queue

**Files:**
- Create: `backend/services/recordingBackgroundCleanupService.js`
- Create: `backend/__tests__/recordingBackgroundCleanupService.test.js`
- Modify: `backend/services/recordingService.js`

- [ ] **Step 1: Add background cleanup tests**

Create `backend/__tests__/recordingBackgroundCleanupService.test.js`:

```javascript
/**
 * Purpose: Verify slow background reconciliation of unregistered recording files.
 * Caller: Vitest backend suite.
 * Deps: recordingBackgroundCleanupService with mocked filesystem, DB reads, and ffprobe.
 * MainFuncs: createRecordingBackgroundCleanupService.
 * SideEffects: None; dependencies are mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { join } from 'path';
import { createRecordingBackgroundCleanupService } from '../services/recordingBackgroundCleanupService.js';

function createService(overrides = {}) {
    const scheduledCallbacks = [];
    const scheduleTimeout = vi.fn((callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
    });
    const fs = {
        access: vi.fn(async () => undefined),
        readdir: vi.fn(async (targetPath) => {
            if (String(targetPath).endsWith('recordings')) return ['camera7'];
            return ['20260518_170000.mp4'];
        }),
        stat: vi.fn(async (targetPath) => ({
            isDirectory: () => String(targetPath).endsWith('camera7'),
            mtimeMs: Date.parse('2026-05-18T09:59:00.000Z'),
            size: 1024,
        })),
    };
    const query = vi.fn((sql) => {
        if (sql.includes('SELECT filename FROM recording_segments')) return [];
        return [];
    });
    const queryOne = vi.fn(() => ({ recording_duration_hours: 5 }));
    const onSegmentCreated = vi.fn();
    const ffprobe = vi.fn(async () => ({ stdout: '', stderr: '' }));

    const service = createRecordingBackgroundCleanupService({
        recordingsBasePath: join('C:\\', 'recordings'),
        fs,
        query,
        queryOne,
        ffprobe,
        isFileBeingProcessed: () => false,
        onSegmentCreated,
        logger: { log: vi.fn(), error: vi.fn() },
        now: () => Date.parse('2026-05-18T10:40:00.000Z'),
        ...overrides,
    });

    return { service, scheduleTimeout, scheduledCallbacks, fs, query, queryOne, onSegmentCreated, ffprobe };
}

describe('recordingBackgroundCleanupService', () => {
    it('uses timezone-aware retention age for unregistered final files', async () => {
        const { service, scheduleTimeout, scheduledCallbacks, onSegmentCreated } = createService();

        service.start(scheduleTimeout);
        await scheduledCallbacks[0]();
        await scheduledCallbacks[1]();

        expect(onSegmentCreated).toHaveBeenCalledWith(7, '20260518_170000.mp4');
    });

    it('does not process a file currently being finalized', async () => {
        const { service, scheduleTimeout, scheduledCallbacks, onSegmentCreated } = createService({
            isFileBeingProcessed: () => true,
        });

        service.start(scheduleTimeout);
        await scheduledCallbacks[0]();
        await scheduledCallbacks[1]();

        expect(onSegmentCreated).not.toHaveBeenCalled();
    });

    it('keeps corrupt unregistered final files until retention cleanup owns deletion', async () => {
        const { service, scheduleTimeout, scheduledCallbacks, onSegmentCreated, ffprobe } = createService({
            ffprobe: vi.fn(async () => {
                throw new Error('invalid mp4');
            }),
            now: () => Date.parse('2026-05-18T10:10:00.000Z'),
        });

        service.start(scheduleTimeout);
        await scheduledCallbacks[0]();
        await scheduledCallbacks[1]();

        expect(ffprobe).toHaveBeenCalled();
        expect(onSegmentCreated).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run background cleanup tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingBackgroundCleanupService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Create background cleanup service**

Create `backend/services/recordingBackgroundCleanupService.js` with this public interface:

```javascript
// Purpose: Own slow background reconciliation of unregistered recording files.
// Caller: recordingService compatibility facade through recording scheduler.
// Deps: filesystem, DB read helpers, recording retention policy, ffprobe callback.
// MainFuncs: createRecordingBackgroundCleanupService, start.
// SideEffects: Schedules queue build/process loops and may enqueue segment recovery.

import { join } from 'path';
import { computeRetentionWindow, getSegmentAgeMs } from './recordingRetentionPolicy.js';

const BUILD_QUEUE_INTERVAL_MS = 5 * 60 * 1000;
const BUILD_QUEUE_INITIAL_DELAY_MS = 30 * 1000;
const PROCESS_QUEUE_INTERVAL_MS = 10 * 1000;
const MIN_UNREGISTERED_FILE_AGE_MS = 30 * 60 * 1000;

export function createRecordingBackgroundCleanupService({
    recordingsBasePath,
    fs,
    query,
    queryOne,
    ffprobe,
    isFileBeingProcessed,
    onSegmentCreated,
    logger = console,
    now = Date.now,
} = {}) {
    let cleanupQueue = [];
    let isBuildingQueue = false;

    function start(scheduleTimeout = setTimeout) {
        logger.log?.('[Cleanup] Starting background cleanup service (1 file per 10s)');

        const scheduledBuildQueue = async () => {
            await buildQueue();
            scheduleTimeout(scheduledBuildQueue, BUILD_QUEUE_INTERVAL_MS);
        };

        const processQueueCycle = async () => {
            await processOneQueueItem();
            scheduleTimeout(processQueueCycle, PROCESS_QUEUE_INTERVAL_MS);
        };

        scheduleTimeout(scheduledBuildQueue, BUILD_QUEUE_INITIAL_DELAY_MS);
        scheduleTimeout(processQueueCycle, PROCESS_QUEUE_INTERVAL_MS);
    }

    async function buildQueue() {
        if (isBuildingQueue) return;
        isBuildingQueue = true;
        try {
            try {
                await fs.access(recordingsBasePath);
            } catch {
                return;
            }

            const cameraDirs = await fs.readdir(recordingsBasePath);
            const unregistered = [];
            for (const dirName of cameraDirs) {
                const cameraIdMatch = String(dirName).match(/^camera(\d+)$/);
                if (!cameraIdMatch) continue;

                const cameraId = Number.parseInt(cameraIdMatch[1], 10);
                const fullPath = join(recordingsBasePath, dirName);
                let dirStats;
                try {
                    dirStats = await fs.stat(fullPath);
                } catch {
                    continue;
                }
                if (!dirStats.isDirectory()) continue;

                const camera = queryOne('SELECT recording_duration_hours FROM cameras WHERE id = ?', [cameraId]);
                const retentionWindow = computeRetentionWindow({
                    retentionHours: camera?.recording_duration_hours,
                    nowMs: now(),
                });
                const existingFilesSet = new Set(
                    query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                        .map((row) => row.filename)
                );

                const filenames = (await fs.readdir(fullPath)).filter((filename) => /^\d{8}_\d{6}\.mp4$/.test(filename));
                for (const filename of filenames) {
                    if (existingFilesSet.has(filename)) continue;
                    const filePath = join(fullPath, filename);
                    try {
                        const stats = await fs.stat(filePath);
                        const ageMs = getSegmentAgeMs({
                            filename,
                            fileMtimeMs: stats.mtimeMs,
                            nowMs: now(),
                        });
                        if (ageMs > MIN_UNREGISTERED_FILE_AGE_MS) {
                            unregistered.push({
                                cameraId,
                                filename,
                                path: filePath,
                                age: ageMs,
                                fileSize: stats.size,
                                beyondRetention: ageMs > retentionWindow.retentionWithGraceMs,
                            });
                        }
                    } catch {
                        logger.error?.(`[BGCleanup] Failed reading unregistered file: camera${cameraId}/${filename}`);
                    }
                }
            }

            cleanupQueue = unregistered.sort((a, b) => {
                if (a.beyondRetention && !b.beyondRetention) return -1;
                if (!a.beyondRetention && b.beyondRetention) return 1;
                return b.age - a.age;
            });
            if (cleanupQueue.length > 0) {
                logger.log?.(`[BGCleanup] Found ${cleanupQueue.length} old unregistered files (30+ min), adding to cleanup queue`);
            }
        } catch (error) {
            logger.error?.('[BGCleanup] Error building queue:', error);
        } finally {
            isBuildingQueue = false;
        }
    }

    async function processOneQueueItem() {
        if (!cleanupQueue.length) return;
        const file = cleanupQueue.shift();

        try {
            await fs.access(file.path);
        } catch {
            return;
        }

        if (isFileBeingProcessed(file.cameraId, file.filename)) {
            logger.log?.(`[BGCleanup] File being processed, skipping: ${file.filename}`);
            return;
        }

        if (file.beyondRetention) {
            logger.log?.(`[BGCleanup] Requeueing old unregistered final file for recovery before deletion: camera${file.cameraId}/${file.filename}`);
            onSegmentCreated(file.cameraId, file.filename);
            return;
        }

        try {
            await ffprobe(file.path);
            logger.log?.(`[BGCleanup] File valid but unregistered (age: ${Math.round(file.age / 60000)}min), triggering registration: ${file.filename}`);
            onSegmentCreated(file.cameraId, file.filename);
        } catch {
            logger.log?.(`[BGCleanup] Keeping corrupt/unplayable file until retention expiry: camera${file.cameraId}/${file.filename} (age: ${Math.round(file.age / 60000)}min)`);
        }
    }

    return { start, buildQueue, processOneQueueItem };
}
```

- [ ] **Step 4: Wire recordingService delegation**

In `backend/services/recordingService.js`, replace the `startBackgroundCleanup()` body with:

```javascript
    startBackgroundCleanup(scheduleTimeout = setTimeout) {
        if (!this.backgroundCleanupService) {
            this.backgroundCleanupService = createRecordingBackgroundCleanupService({
                recordingsBasePath: RECORDINGS_BASE_PATH,
                fs: fsPromises,
                query,
                queryOne,
                ffprobe: (filePath) => execPromise(`ffprobe -v error "${filePath}"`, { timeout: 3000 }),
                isFileBeingProcessed: (cameraId, filename) => filesBeingProcessed.has(`${cameraId}:${filename}`),
                onSegmentCreated: (cameraId, filename) => this.onSegmentCreated(cameraId, filename),
                logger: console,
            });
        }

        this.backgroundCleanupService.start(scheduleTimeout);
    }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingBackgroundCleanupService.test.js recordingService.test.js recordingRetentionPolicy.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add backend/services/recordingBackgroundCleanupService.js backend/services/recordingService.js backend/__tests__/recordingBackgroundCleanupService.test.js
git commit -m "Fix: extract recording background cleanup queue"
```

### Task 6: Extract Scheduled Maintenance Orchestrator

**Files:**
- Create: `backend/services/recordingMaintenanceService.js`
- Create: `backend/__tests__/recordingMaintenanceService.test.js`
- Modify: `backend/services/recordingService.js`

- [ ] **Step 1: Add maintenance service tests**

Create `backend/__tests__/recordingMaintenanceService.test.js`:

```javascript
/**
 * Purpose: Verify scheduled recording maintenance orchestration and state persistence.
 * Caller: Vitest backend suite.
 * Deps: recordingMaintenanceService with mocked cleanup, emergency, DB, and filesystem callbacks.
 * MainFuncs: createRecordingMaintenanceService.
 * SideEffects: None; dependencies are mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRecordingMaintenanceService } from '../services/recordingMaintenanceService.js';

describe('recordingMaintenanceService', () => {
    it('cleans enabled cameras plus camera directories and records success state', async () => {
        const scheduledCallbacks = [];
        const scheduleTimeout = vi.fn((callback) => {
            scheduledCallbacks.push(callback);
            return scheduledCallbacks.length;
        });
        const cleanupCamera = vi.fn(async () => ({ deleted: 1, deletedBytes: 2048, failed: 0 }));
        const emergencyDiskCheck = vi.fn(async () => ({ status: 'ok', deleted: 1, deletedBytes: 4096 }));
        const stateRepository = {
            upsertRunState: vi.fn(),
            insertRunEvent: vi.fn(),
        };
        const service = createRecordingMaintenanceService({
            fs: {
                access: vi.fn(async () => undefined),
                readdir: vi.fn(async () => ['camera8']),
            },
            query: vi.fn(() => [{ id: 7 }]),
            recordingsBasePath: 'C:\\recordings',
            cleanupCamera,
            emergencyDiskCheck,
            stateRepository,
            logger: { log: vi.fn(), error: vi.fn() },
            now: () => Date.parse('2026-05-18T10:00:00.000Z'),
        });

        service.startScheduledCleanup(scheduleTimeout);
        await scheduledCallbacks[0]();

        expect(cleanupCamera).toHaveBeenCalledWith(7);
        expect(cleanupCamera).toHaveBeenCalledWith(8);
        expect(emergencyDiskCheck).toHaveBeenCalledTimes(1);
        expect(stateRepository.upsertRunState).toHaveBeenCalledWith(expect.objectContaining({
            maintenanceType: 'scheduled_cleanup',
            status: 'ok',
            deleted: 3,
            deletedBytes: 8192,
        }));
        expect(stateRepository.insertRunEvent).toHaveBeenCalledWith(expect.objectContaining({
            maintenanceType: 'scheduled_cleanup',
            status: 'ok',
        }));
    });

    it('records failed state when scheduled cleanup throws', async () => {
        const scheduledCallbacks = [];
        const stateRepository = {
            upsertRunState: vi.fn(),
            insertRunEvent: vi.fn(),
        };
        const service = createRecordingMaintenanceService({
            fs: { access: vi.fn(async () => undefined), readdir: vi.fn(async () => []) },
            query: vi.fn(() => [{ id: 7 }]),
            recordingsBasePath: 'C:\\recordings',
            cleanupCamera: vi.fn(async () => {
                throw new Error('cleanup failed');
            }),
            emergencyDiskCheck: vi.fn(),
            stateRepository,
            logger: { log: vi.fn(), error: vi.fn() },
            now: () => Date.parse('2026-05-18T10:00:00.000Z'),
        });

        service.startScheduledCleanup((callback) => {
            scheduledCallbacks.push(callback);
            return scheduledCallbacks.length;
        });
        await scheduledCallbacks[0]();

        expect(stateRepository.upsertRunState).toHaveBeenCalledWith(expect.objectContaining({
            maintenanceType: 'scheduled_cleanup',
            status: 'failed',
            errorMessage: 'cleanup failed',
        }));
    });
});
```

- [ ] **Step 2: Run maintenance service tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingMaintenanceService.test.js
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Create maintenance service**

Create `backend/services/recordingMaintenanceService.js`:

```javascript
// Purpose: Own scheduled recording maintenance orchestration outside the recording facade.
// Caller: recordingService compatibility methods and recordingScheduler.
// Deps: injected fs/query/cleanup/emergency/state repository callbacks.
// MainFuncs: createRecordingMaintenanceService, startScheduledCleanup, runScheduledCleanup.
// SideEffects: Schedules cleanup timers, runs cleanup, writes maintenance state.

const SCHEDULED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const SCHEDULED_CLEANUP_INITIAL_DELAY_MS = 2 * 60 * 1000;

export function createRecordingMaintenanceService({
    fs,
    query,
    recordingsBasePath,
    cleanupCamera,
    emergencyDiskCheck,
    stateRepository,
    logger = console,
    now = Date.now,
} = {}) {
    function startScheduledCleanup(scheduleTimeout = setTimeout) {
        logger.log?.('[Cleanup] Starting scheduled cleanup service (every 5 minutes)');

        const runScheduledClean = async () => {
            await runScheduledCleanup();
            scheduleTimeout(runScheduledClean, SCHEDULED_CLEANUP_INTERVAL_MS);
        };

        scheduleTimeout(runScheduledClean, SCHEDULED_CLEANUP_INITIAL_DELAY_MS);
    }

    async function runScheduledCleanup() {
        const startedAt = new Date(now()).toISOString();
        const result = {
            deleted: 0,
            deletedBytes: 0,
            failed: 0,
            errorMessage: null,
        };

        try {
            const cameraIds = await listMaintenanceCameraIds();
            logger.log?.(`[Cleanup] Running scheduled cleanup for ${cameraIds.size} cameras...`);

            for (const cameraId of cameraIds) {
                const cleanupResult = await cleanupCamera(cameraId);
                result.deleted += cleanupResult.deleted || 0;
                result.deletedBytes += cleanupResult.deletedBytes || 0;
                result.failed += cleanupResult.failed || 0;
            }

            const emergencyResult = await emergencyDiskCheck();
            result.deleted += emergencyResult?.deleted || 0;
            result.deletedBytes += emergencyResult?.deletedBytes || 0;

            persistRunState({
                maintenanceType: 'scheduled_cleanup',
                status: 'ok',
                startedAt,
                finishedAt: new Date(now()).toISOString(),
                deleted: result.deleted,
                deletedBytes: result.deletedBytes,
                errorMessage: null,
            });
            logger.log?.('[Cleanup] Scheduled cleanup complete');
            return result;
        } catch (error) {
            result.errorMessage = error.message;
            persistRunState({
                maintenanceType: 'scheduled_cleanup',
                status: 'failed',
                startedAt,
                finishedAt: new Date(now()).toISOString(),
                deleted: result.deleted,
                deletedBytes: result.deletedBytes,
                errorMessage: error.message,
            });
            logger.error?.('[Cleanup] Scheduled cleanup error:', error);
            return result;
        }
    }

    async function listMaintenanceCameraIds() {
        const enabledCameras = query('SELECT id FROM cameras WHERE enable_recording = 1 AND enabled = 1');
        const cameraIds = new Set(enabledCameras.map((camera) => camera.id));

        try {
            await fs.access(recordingsBasePath);
            const dirs = await fs.readdir(recordingsBasePath);
            for (const dir of dirs) {
                const match = String(dir).match(/^camera(\d+)$/);
                if (match) {
                    cameraIds.add(Number.parseInt(match[1], 10));
                }
            }
        } catch {
            return cameraIds;
        }

        return cameraIds;
    }

    function persistRunState(payload) {
        stateRepository.upsertRunState(payload);
        stateRepository.insertRunEvent(payload);
    }

    return { startScheduledCleanup, runScheduledCleanup, listMaintenanceCameraIds };
}
```

- [ ] **Step 4: Wire recordingService scheduled cleanup delegation**

In `backend/services/recordingService.js`, initialize the service lazily and replace `startScheduledCleanup()` body with:

```javascript
    getMaintenanceService() {
        if (!this.maintenanceService) {
            this.maintenanceService = createRecordingMaintenanceService({
                fs: fsPromises,
                query,
                recordingsBasePath: RECORDINGS_BASE_PATH,
                cleanupCamera: (cameraId) => this.cleanupOldSegments(cameraId),
                emergencyDiskCheck: () => this.emergencyDiskSpaceCheck(),
                stateRepository: recordingMaintenanceStateRepository,
                logger: console,
            });
        }

        return this.maintenanceService;
    }

    startScheduledCleanup(scheduleTimeout = setTimeout) {
        this.getMaintenanceService().startScheduledCleanup(scheduleTimeout);
    }
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
cd backend
npm test -- recordingMaintenanceService.test.js recordingService.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add backend/services/recordingMaintenanceService.js backend/services/recordingService.js backend/__tests__/recordingMaintenanceService.test.js
git commit -m "Fix: extract recording scheduled maintenance"
```

### Task 7: Wire Maintenance State Into Assurance

**Files:**
- Modify: `backend/services/recordingAssuranceService.js`
- Modify: `backend/__tests__/recordingAssuranceService.test.js`

- [ ] **Step 1: Add assurance test**

Add this test to `backend/__tests__/recordingAssuranceService.test.js`:

```javascript
it('includes recording maintenance health state', () => {
    queryOneMock.mockImplementation((sql, params) => {
        if (sql.includes('recording_maintenance_state') && params[0] === 'scheduled_cleanup') {
            return {
                maintenance_type: 'scheduled_cleanup',
                status: 'ok',
                finished_at: '2026-05-18T10:00:00.000Z',
                deleted: 2,
                deleted_bytes: 4096,
                error_message: null,
            };
        }
        if (sql.includes('recording_maintenance_state') && params[0] === 'emergency_cleanup') {
            return {
                maintenance_type: 'emergency_cleanup',
                status: 'skipped_enough_space',
                finished_at: '2026-05-18T10:00:01.000Z',
                deleted: 0,
                deleted_bytes: 0,
                error_message: null,
            };
        }
        return { active_recordings: 0 };
    });

    const snapshot = recordingAssuranceService.getSnapshot();

    expect(snapshot.maintenance).toEqual({
        scheduledCleanup: expect.objectContaining({ status: 'ok', deleted: 2 }),
        emergencyCleanup: expect.objectContaining({ status: 'skipped_enough_space', deleted: 0 }),
    });
});
```

- [ ] **Step 2: Run assurance test to verify failure**

Run:

```bash
cd backend
npm test -- recordingAssuranceService.test.js -t "maintenance health"
```

Expected: FAIL because assurance snapshot does not include maintenance state.

- [ ] **Step 3: Add maintenance snapshot read**

In `backend/services/recordingAssuranceService.js`, add repository reads:

```javascript
const scheduledCleanup = recordingMaintenanceStateRepository.getLatestState('scheduled_cleanup');
const emergencyCleanup = recordingMaintenanceStateRepository.getLatestState('emergency_cleanup');

return {
    ...snapshot,
    maintenance: {
        scheduledCleanup,
        emergencyCleanup,
    },
};
```

Keep existing snapshot fields unchanged.

- [ ] **Step 4: Run assurance tests**

Run:

```bash
cd backend
npm test -- recordingAssuranceService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add backend/services/recordingAssuranceService.js backend/__tests__/recordingAssuranceService.test.js
git commit -m "Fix: expose recording maintenance state"
```

### Task 8: Add Circuit-Breaker Policy Without Enabling Auto-Pause Yet

**Files:**
- Create: `backend/services/recordingStoragePressurePolicy.js`
- Create: `backend/__tests__/recordingStoragePressurePolicy.test.js`
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Add pure policy tests**

Create `backend/__tests__/recordingStoragePressurePolicy.test.js`:

```javascript
/**
 * Purpose: Verify recording storage pressure severity decisions.
 * Caller: Vitest backend suite.
 * Deps: recordingStoragePressurePolicy.
 * MainFuncs: classifyRecordingStoragePressure.
 * SideEffects: None.
 */

import { describe, expect, it } from 'vitest';
import { classifyRecordingStoragePressure } from '../services/recordingStoragePressurePolicy.js';

describe('recordingStoragePressurePolicy', () => {
    it('classifies normal, warning, critical, and emergency disk states', () => {
        expect(classifyRecordingStoragePressure({ freeBytes: 12 * 1024 ** 3 }).level).toBe('normal');
        expect(classifyRecordingStoragePressure({ freeBytes: 9 * 1024 ** 3 }).level).toBe('warning');
        expect(classifyRecordingStoragePressure({ freeBytes: 4 * 1024 ** 3 }).level).toBe('critical');
        expect(classifyRecordingStoragePressure({ freeBytes: 512 * 1024 ** 2 }).level).toBe('emergency');
    });

    it('does not recommend pause outside critical emergency pressure', () => {
        expect(classifyRecordingStoragePressure({ freeBytes: 4 * 1024 ** 3 }).shouldPauseNonPriorityRecording).toBe(false);
        expect(classifyRecordingStoragePressure({ freeBytes: 512 * 1024 ** 2 }).shouldPauseNonPriorityRecording).toBe(true);
    });
});
```

- [ ] **Step 2: Run policy tests to verify failure**

Run:

```bash
cd backend
npm test -- recordingStoragePressurePolicy.test.js
```

Expected: FAIL because the policy does not exist.

- [ ] **Step 3: Create storage pressure policy**

Create `backend/services/recordingStoragePressurePolicy.js`:

```javascript
// Purpose: Classify recording storage pressure with explicit thresholds for future circuit-breaker wiring.
// Caller: recordingEmergencyDiskService and future operator alerting.
// Deps: None.
// MainFuncs: classifyRecordingStoragePressure.
// SideEffects: None.

const GIB = 1024 * 1024 * 1024;

export function classifyRecordingStoragePressure({ freeBytes }) {
    if (!Number.isFinite(freeBytes)) {
        return { level: 'unknown', shouldRunEmergencyCleanup: false, shouldPauseNonPriorityRecording: false };
    }

    if (freeBytes <= 1 * GIB) {
        return { level: 'emergency', shouldRunEmergencyCleanup: true, shouldPauseNonPriorityRecording: true };
    }

    if (freeBytes <= 5 * GIB) {
        return { level: 'critical', shouldRunEmergencyCleanup: true, shouldPauseNonPriorityRecording: false };
    }

    if (freeBytes <= 10 * GIB) {
        return { level: 'warning', shouldRunEmergencyCleanup: false, shouldPauseNonPriorityRecording: false };
    }

    return { level: 'normal', shouldRunEmergencyCleanup: false, shouldPauseNonPriorityRecording: false };
}
```

- [ ] **Step 4: Update module map**

Update `backend/services/.module_map.md` under Recording domain:

```markdown
- `recordingStoragePressurePolicy.js`: pure storage pressure threshold policy for cleanup alerting and future non-priority recording pause decisions.
```

- [ ] **Step 5: Run policy tests**

Run:

```bash
cd backend
npm test -- recordingStoragePressurePolicy.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git status --short
git add backend/services/recordingStoragePressurePolicy.js backend/__tests__/recordingStoragePressurePolicy.test.js backend/services/.module_map.md
git commit -m "Fix: add recording storage pressure policy"
```

### Task 9: Final Structural Guard Tests

**Files:**
- Modify: `backend/__tests__/recordingService.test.js`
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Add architecture guard test**

Add this test to `backend/__tests__/recordingService.test.js`:

```javascript
it('keeps recordingService as a facade for maintenance internals', async () => {
    const { readFile } = await import('fs/promises');
    const source = await readFile(new URL('../services/recordingService.js', import.meta.url), 'utf8');

    expect(source).toContain('createRecordingMaintenanceService');
    expect(source).toContain('createRecordingEmergencyDiskService');
    expect(source).toContain('createRecordingBackgroundCleanupService');
    expect(source).not.toContain('const cleanupQueue = []');
    expect(source).not.toContain('powershell -Command "(Get-PSDrive');
    expect(source).not.toContain('df -B1');
});
```

- [ ] **Step 2: Run architecture guard**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "facade for maintenance internals"
```

Expected: PASS after Tasks 3-6.

- [ ] **Step 3: Update module map invariants**

Update `backend/services/.module_map.md` Recording domain to state:

```markdown
- `recordingMaintenanceService.js`: scheduled per-camera cleanup orchestration, emergency cleanup dispatch, and maintenance state recording.
- `recordingEmergencyDiskService.js`: low-disk cleanup orchestration; DB-registered segment deletion uses cleanupService, filesystem final orphans are only queued for recovery.
- `recordingBackgroundCleanupService.js`: slow queue for unregistered final MP4 reconciliation; uses timezone-aware retention age and does not delete final MP4 files.
- `recordingDiskSpaceService.js`: OS-specific free-space read boundary.
- Recording maintenance invariant: `recordingService.js` remains a facade; timer loops and disk cleanup decisions live in maintenance services with focused tests.
```

- [ ] **Step 4: Run focused recording suite**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingCleanupService.test.js recordingEmergencyDiskService.test.js recordingBackgroundCleanupService.test.js recordingMaintenanceService.test.js recordingDiskSpaceService.test.js recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js recordingProcessTimePolicy.test.js recordingProcessManager.test.js recordingPlaybackService.test.js recordingSegmentRepository.test.js recordingAssuranceService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git status --short
git add backend/__tests__/recordingService.test.js backend/services/.module_map.md
git commit -m "Fix: guard recording maintenance structure"
```

### Task 10: Full Gate And Push

**Files:**
- No new files.

- [ ] **Step 1: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: exit code 0.

- [ ] **Step 2: Run backend full gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected: migration PASS and all backend tests PASS.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only recording maintenance service, tests, migration, and map files are changed since the last commit.

- [ ] **Step 4: Push**

Run:

```bash
git push origin main
```

Expected: branch `main` pushed successfully.

## Rollback Strategy

If any extraction causes a runtime failure, revert the latest task commit only. Because each task keeps the public `recordingService` method names stable, rollback should not require route/frontend/deployment changes.

## Acceptance Criteria

- `recordingService.js` no longer contains raw disk free-space shell commands.
- `recordingService.js` no longer contains background cleanup queue state.
- Scheduled cleanup state is queryable from DB.
- Emergency cleanup still deletes only through `recordingCleanupService` or `recordingFileOperationService`.
- Final filesystem orphans are still queued for recovery, not directly deleted.
- Timezone-aware filename age is used by background cleanup.
- `npm run migrate` passes.
- `npm test` passes.
- Every task is committed separately and final branch is pushed.

## Self-Review

- Spec coverage: covers structure from recording facade to scheduled cleanup, background cleanup, emergency cleanup, disk pressure policy, observability, tests, migration, docs, and push.
- Placeholder scan: clean; no deferred placeholders, no unspecified test commands, no undefined service names in later tasks.
- Type consistency: all new service factory names use `createRecording*Service`; maintenance state field names are consistent across migration, repository, tests, and assurance plan.
