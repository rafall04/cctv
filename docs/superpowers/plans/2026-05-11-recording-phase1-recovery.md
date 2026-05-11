# Recording Phase 1 Recovery Implementation Plan

<!--
Purpose: Implementation plan for crash-tolerant MP4 recording finalization without changing playback format.
Caller: Agents implementing backend recording lifecycle hardening after PM2 restart and power-loss analysis.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recordingService.js, recordingProcessManager.js, recordingSegmentRepository.js, recordingCleanupService.js, recordingPlaybackService.js.
MainFuncs: Defines phased TDD tasks for pending MP4 output, idempotent finalization, startup/shutdown recovery, cleanup safety, diagnostics, and verification.
SideEffects: Documentation only; no runtime behavior changes.
-->

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording segments survive PM2 restart and unexpected server shutdown by only exposing validated final MP4 files to playback while retaining and recovering pending/orphan files safely.

**Architecture:** Keep `.mp4` as the final playback format and add an idempotent recovery pipeline around it. FFmpeg writes active segments to `recordings/cameraN/pending/*.mp4.partial`; one finalizer validates/remuxes/promotes files to final `.mp4` and upserts `recording_segments`; startup, scanner, shutdown, and cleanup all use the same file classification and finalization rules.

**Tech Stack:** Node.js 20 ES modules, Fastify backend services, SQLite via `connectionPool.js`, FFmpeg/ffprobe child processes, Vitest backend tests.

---

## File Structure

- Create `backend/services/recordingSegmentFilePolicy.js`
  - Pure path/name policy for final, partial, temp, and failed segment files.
  - No filesystem or database access.
- Create `backend/services/recordingSegmentFinalizer.js`
  - Owns idempotent finalization locks, size-stability checks, ffprobe/remux/promote flow, and DB upsert.
  - Depends on injected repository, fs promises, spawn/exec behavior through small local helpers.
- Create `backend/services/recordingRecoveryDiagnosticsRepository.js`
  - Persists lightweight recovery diagnostics for files that exist but cannot enter playback yet.
- Create `backend/database/migrations/zz_20260511_add_recording_recovery_diagnostics.js`
  - Adds `recording_recovery_diagnostics` table and indexes.
- Modify `backend/services/recordingService.js`
  - Build pending output directory/filename, delegate segment handling to finalizer, scan pending/final orphan files, drain finalizer on shutdown.
- Modify `backend/services/recordingCleanupService.js`
  - Respect partial/tmp/diagnostic recovery states and retention+grace before deletion.
- Modify `backend/services/recordingAssuranceService.js`
  - Surface recovery diagnostic counts for admin visibility.
- Modify `backend/services/.module_map.md`
  - Document finalizer, file policy, diagnostics, and recovery flow.
- Test `backend/__tests__/recordingSegmentFilePolicy.test.js`
- Test `backend/__tests__/recordingSegmentFinalizer.test.js`
- Modify `backend/__tests__/recordingService.test.js`
- Modify `backend/__tests__/recordingCleanupService.test.js`
- Modify `backend/__tests__/recordingAssuranceService.test.js`

## Invariants

- Playback reads only `recording_segments`, and `recording_segments` contains only final `.mp4` files that exist and have `duration >= 1`.
- File recovery is idempotent: the same camera/filename can be seen by FFmpeg close, scanner, startup recovery, and shutdown recovery without duplicate DB rows or concurrent remux.
- Cleanup never deletes partial, temp, failed, or final-orphan files inside retention+grace.
- Invalid `00` duration files are retained and recorded in diagnostics instead of silently disappearing.
- Power loss during remux may leave `.tmp`; startup recovery must either promote a valid `.tmp`, retry from source partial, or record a diagnostic.

---

### Task 1: Segment File Policy

**Files:**
- Create: `backend/services/recordingSegmentFilePolicy.js`
- Test: `backend/__tests__/recordingSegmentFilePolicy.test.js`

- [ ] **Step 1: Write the failing policy tests**

```javascript
/**
 * Purpose: Verify recording segment filename/path classification for finalization recovery.
 * Caller: Vitest backend test suite.
 * Deps: recordingSegmentFilePolicy.
 * MainFuncs: isFinalSegmentFilename, isPartialSegmentFilename, isTempSegmentFilename, parseSegmentFilename, getPendingRecordingDir, getFinalRecordingPath.
 * SideEffects: None.
 */
import { describe, expect, it } from 'vitest';
import {
    getFinalRecordingPath,
    getPendingRecordingDir,
    getPendingRecordingPattern,
    getTempRecordingPath,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
    parseSegmentFilename,
    toFinalSegmentFilename,
} from '../services/recordingSegmentFilePolicy.js';

describe('recordingSegmentFilePolicy', () => {
    it('classifies final, partial, and temp segment filenames', () => {
        expect(isFinalSegmentFilename('20260511_211000.mp4')).toBe(true);
        expect(isFinalSegmentFilename('20260511_211000.mp4.partial')).toBe(false);
        expect(isPartialSegmentFilename('20260511_211000.mp4.partial')).toBe(true);
        expect(isTempSegmentFilename('20260511_211000.mp4.tmp')).toBe(true);
        expect(isTempSegmentFilename('20260511_211000.mp4.remux.mp4')).toBe(true);
    });

    it('parses timestamps from final and partial names into the same final filename', () => {
        expect(parseSegmentFilename('20260511_211000.mp4')).toMatchObject({
            finalFilename: '20260511_211000.mp4',
            timestampIso: '2026-05-11T21:10:00.000Z',
        });
        expect(parseSegmentFilename('20260511_211000.mp4.partial')).toMatchObject({
            finalFilename: '20260511_211000.mp4',
            timestampIso: '2026-05-11T21:10:00.000Z',
        });
        expect(toFinalSegmentFilename('20260511_211000.mp4.partial')).toBe('20260511_211000.mp4');
    });

    it('builds stable pending and final paths under the camera directory', () => {
        const basePath = 'C:\\recordings';
        expect(getPendingRecordingDir(basePath, 3)).toBe('C:\\recordings\\camera3\\pending');
        expect(getPendingRecordingPattern(basePath, 3)).toBe('C:\\recordings\\camera3\\pending\\%Y%m%d_%H%M%S.mp4.partial');
        expect(getFinalRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe('C:\\recordings\\camera3\\20260511_211000.mp4');
        expect(getTempRecordingPath(basePath, 3, '20260511_211000.mp4')).toBe('C:\\recordings\\camera3\\20260511_211000.mp4.tmp');
    });

    it('rejects unsupported names', () => {
        expect(parseSegmentFilename('bad.mp4')).toBeNull();
        expect(parseSegmentFilename('../20260511_211000.mp4')).toBeNull();
        expect(parseSegmentFilename('20260511_211000.ts')).toBeNull();
    });
});
```

- [ ] **Step 2: Run policy test to verify it fails**

Run: `cd backend && npm test -- recordingSegmentFilePolicy.test.js`

Expected: FAIL because `backend/services/recordingSegmentFilePolicy.js` does not exist.

- [ ] **Step 3: Implement the pure policy module**

```javascript
// Purpose: Classify and build recording segment paths for MP4 finalization recovery.
// Caller: recordingService, recordingSegmentFinalizer, recording cleanup, and tests.
// Deps: node:path.
// MainFuncs: getPendingRecordingDir, getPendingRecordingPattern, isFinalSegmentFilename, parseSegmentFilename.
// SideEffects: None.

import { join } from 'path';

const SEGMENT_STAMP = '(\\d{4})(\\d{2})(\\d{2})_(\\d{2})(\\d{2})(\\d{2})';
const FINAL_RE = new RegExp(`^${SEGMENT_STAMP}\\.mp4$`);
const PARTIAL_RE = new RegExp(`^${SEGMENT_STAMP}\\.mp4\\.partial$`);
const TEMP_RE = new RegExp(`^${SEGMENT_STAMP}\\.mp4\\.(tmp|remux\\.mp4)$`);

export function getCameraRecordingDir(basePath, cameraId) {
    return join(basePath, `camera${cameraId}`);
}

export function getPendingRecordingDir(basePath, cameraId) {
    return join(getCameraRecordingDir(basePath, cameraId), 'pending');
}

export function getPendingRecordingPattern(basePath, cameraId) {
    return join(getPendingRecordingDir(basePath, cameraId), '%Y%m%d_%H%M%S.mp4.partial');
}

export function getFinalRecordingPath(basePath, cameraId, finalFilename) {
    return join(getCameraRecordingDir(basePath, cameraId), finalFilename);
}

export function getTempRecordingPath(basePath, cameraId, finalFilename) {
    return `${getFinalRecordingPath(basePath, cameraId, finalFilename)}.tmp`;
}

export function isFinalSegmentFilename(filename) {
    return FINAL_RE.test(filename);
}

export function isPartialSegmentFilename(filename) {
    return PARTIAL_RE.test(filename);
}

export function isTempSegmentFilename(filename) {
    return TEMP_RE.test(filename);
}

export function toFinalSegmentFilename(filename) {
    const parsed = parseSegmentFilename(filename);
    return parsed?.finalFilename ?? null;
}

export function parseSegmentFilename(filename) {
    const text = String(filename || '');
    if (text.includes('/') || text.includes('\\')) {
        return null;
    }

    const match = text.match(FINAL_RE) || text.match(PARTIAL_RE) || text.match(TEMP_RE);
    if (!match) {
        return null;
    }

    const [, year, month, day, hour, minute, second] = match;
    const timestamp = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`);
    if (Number.isNaN(timestamp.getTime())) {
        return null;
    }

    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        timestamp,
        timestampIso: timestamp.toISOString(),
        finalFilename: `${year}${month}${day}_${hour}${minute}${second}.mp4`,
    };
}
```

- [ ] **Step 4: Run policy test to verify it passes**

Run: `cd backend && npm test -- recordingSegmentFilePolicy.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingSegmentFilePolicy.js backend/__tests__/recordingSegmentFilePolicy.test.js
git commit -m "Add: recording segment file policy"
```

---

### Task 2: Recovery Diagnostics Persistence

**Files:**
- Create: `backend/database/migrations/zz_20260511_add_recording_recovery_diagnostics.js`
- Create: `backend/services/recordingRecoveryDiagnosticsRepository.js`
- Test: `backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js`

- [ ] **Step 1: Write repository tests**

```javascript
/**
 * Purpose: Verify recording recovery diagnostic persistence uses bounded upserts and reads.
 * Caller: Vitest backend test suite.
 * Deps: mocked connectionPool, recordingRecoveryDiagnosticsRepository.
 * MainFuncs: upsertDiagnostic, clearDiagnostic, listActiveByCamera, summarizeActive.
 * SideEffects: Uses mocks only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeMock = vi.fn();
const queryMock = vi.fn();

vi.mock('../database/connectionPool.js', () => ({
    execute: executeMock,
    query: queryMock,
}));

describe('recordingRecoveryDiagnosticsRepository', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        executeMock.mockReturnValue({ changes: 1 });
        queryMock.mockReturnValue([]);
    });

    it('upserts active diagnostic by camera and filename', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.upsertDiagnostic({
            cameraId: 7,
            filename: '20260511_211000.mp4',
            filePath: 'C:\\recordings\\camera7\\pending\\20260511_211000.mp4.partial',
            state: 'retryable_failed',
            reason: 'invalid_duration',
            fileSize: 4096,
            detectedAt: '2026-05-11T21:14:00.000Z',
        });

        expect(executeMock).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO recording_recovery_diagnostics'), [
            7,
            '20260511_211000.mp4',
            'C:\\recordings\\camera7\\pending\\20260511_211000.mp4.partial',
            'retryable_failed',
            'invalid_duration',
            4096,
            '2026-05-11T21:14:00.000Z',
            '2026-05-11T21:14:00.000Z',
            1,
        ]);
    });

    it('clears diagnostic after successful registration', async () => {
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;
        repository.clearDiagnostic({ cameraId: 7, filename: '20260511_211000.mp4' });

        expect(executeMock).toHaveBeenCalledWith(
            'UPDATE recording_recovery_diagnostics SET active = 0, resolved_at = CURRENT_TIMESTAMP WHERE camera_id = ? AND filename = ? AND active = 1',
            [7, '20260511_211000.mp4']
        );
    });

    it('summarizes active diagnostics by state', async () => {
        queryMock.mockReturnValue([{ state: 'retryable_failed', count: 2 }, { state: 'unrecoverable', count: 1 }]);
        const repository = (await import('../services/recordingRecoveryDiagnosticsRepository.js')).default;

        expect(repository.summarizeActive()).toEqual({ retryable_failed: 2, unrecoverable: 1 });
    });
});
```

- [ ] **Step 2: Run repository test to verify it fails**

Run: `cd backend && npm test -- recordingRecoveryDiagnosticsRepository.test.js`

Expected: FAIL because repository file does not exist.

- [ ] **Step 3: Add migration**

```javascript
// Purpose: Add recording recovery diagnostics for pending/orphan files that cannot enter playback yet.
// Caller: Backend migration runner.
// Deps: better-sqlite3 database file.
// MainFuncs: migration script body.
// SideEffects: Creates recording_recovery_diagnostics table and indexes.

import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const dbPath = join(__dirname, '..', '..', 'data', 'cctv.db');
const db = new Database(dbPath);

try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS recording_recovery_diagnostics (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            camera_id INTEGER NOT NULL,
            filename TEXT NOT NULL,
            file_path TEXT NOT NULL,
            state TEXT NOT NULL,
            reason TEXT NOT NULL,
            file_size INTEGER DEFAULT 0,
            detected_at DATETIME NOT NULL,
            last_seen_at DATETIME NOT NULL,
            resolved_at DATETIME,
            active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_recording_recovery_active_file
        ON recording_recovery_diagnostics(camera_id, filename, active);

        CREATE INDEX IF NOT EXISTS idx_recording_recovery_camera_state
        ON recording_recovery_diagnostics(camera_id, state, active);

        CREATE INDEX IF NOT EXISTS idx_recording_recovery_active_seen
        ON recording_recovery_diagnostics(active, last_seen_at);
    `);

    console.log('Created recording_recovery_diagnostics table and indexes');
} finally {
    db.close();
}
```

- [ ] **Step 4: Add repository**

```javascript
// Purpose: Persist recovery diagnostics for recording files that are pending, retryable, or unrecoverable.
// Caller: recordingSegmentFinalizer, recordingService scanner, recording assurance service.
// Deps: database connectionPool.
// MainFuncs: upsertDiagnostic, clearDiagnostic, listActiveByCamera, summarizeActive.
// SideEffects: Reads and writes recording_recovery_diagnostics rows.

import { execute, query } from '../database/connectionPool.js';

class RecordingRecoveryDiagnosticsRepository {
    upsertDiagnostic({
        cameraId,
        filename,
        filePath,
        state,
        reason,
        fileSize = 0,
        detectedAt = new Date().toISOString(),
        lastSeenAt = detectedAt,
        active = 1,
    }) {
        return execute(
            `INSERT INTO recording_recovery_diagnostics
            (camera_id, filename, file_path, state, reason, file_size, detected_at, last_seen_at, active)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(camera_id, filename, active) DO UPDATE SET
                file_path = excluded.file_path,
                state = excluded.state,
                reason = excluded.reason,
                file_size = excluded.file_size,
                last_seen_at = excluded.last_seen_at,
                updated_at = CURRENT_TIMESTAMP`,
            [cameraId, filename, filePath, state, reason, fileSize, detectedAt, lastSeenAt, active]
        );
    }

    clearDiagnostic({ cameraId, filename }) {
        return execute(
            'UPDATE recording_recovery_diagnostics SET active = 0, resolved_at = CURRENT_TIMESTAMP WHERE camera_id = ? AND filename = ? AND active = 1',
            [cameraId, filename]
        );
    }

    listActiveByCamera(cameraId, limit = 100) {
        return query(
            `SELECT *
            FROM recording_recovery_diagnostics
            WHERE camera_id = ? AND active = 1
            ORDER BY last_seen_at DESC
            LIMIT ?`,
            [cameraId, limit]
        );
    }

    summarizeActive() {
        const rows = query(
            `SELECT state, COUNT(*) as count
            FROM recording_recovery_diagnostics
            WHERE active = 1
            GROUP BY state`,
            []
        );

        return rows.reduce((summary, row) => {
            summary[row.state] = row.count;
            return summary;
        }, {});
    }
}

export default new RecordingRecoveryDiagnosticsRepository();
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- recordingRecoveryDiagnosticsRepository.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/database/migrations/zz_20260511_add_recording_recovery_diagnostics.js backend/services/recordingRecoveryDiagnosticsRepository.js backend/__tests__/recordingRecoveryDiagnosticsRepository.test.js
git commit -m "Add: recording recovery diagnostics"
```

---

### Task 3: Segment Finalizer Service

**Files:**
- Create: `backend/services/recordingSegmentFinalizer.js`
- Test: `backend/__tests__/recordingSegmentFinalizer.test.js`

- [ ] **Step 1: Write failing finalizer tests**

```javascript
/**
 * Purpose: Verify idempotent MP4 segment finalization from pending/final orphan files into DB-backed playback rows.
 * Caller: Vitest backend test suite.
 * Deps: mocked fs, child_process, segment repository, diagnostics repository.
 * MainFuncs: createRecordingSegmentFinalizer, finalizeSegment, drain.
 * SideEffects: Uses mocks only.
 */
import { EventEmitter } from 'events';
import { promisify } from 'util';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const execMock = vi.fn();
const spawnMock = vi.fn();
const fsPromisesMock = {
    access: vi.fn(),
    stat: vi.fn(),
    rename: vi.fn(),
    copyFile: vi.fn(),
    unlink: vi.fn(),
    mkdir: vi.fn(),
};
const repository = { upsertSegment: vi.fn() };
const diagnostics = { upsertDiagnostic: vi.fn(), clearDiagnostic: vi.fn() };

vi.mock('child_process', () => ({ exec: execMock, spawn: spawnMock }));
vi.mock('fs', () => ({ promises: fsPromisesMock, existsSync: vi.fn(() => true), unlinkSync: vi.fn() }));

function createProcess(exitCode = 0) {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    setTimeout(() => child.emit('close', exitCode), 0);
    return child;
}

describe('recordingSegmentFinalizer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.resetModules();
        vi.clearAllMocks();
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '240.2\n', stderr: '' }));
        fsPromisesMock.access.mockResolvedValue(undefined);
        fsPromisesMock.mkdir.mockResolvedValue(undefined);
        fsPromisesMock.stat
            .mockResolvedValueOnce({ size: 1000, mtimeMs: Date.now() - 60000 })
            .mockResolvedValueOnce({ size: 1000, mtimeMs: Date.now() - 60000 })
            .mockResolvedValue({ size: 2048, mtimeMs: Date.now() - 60000 });
        fsPromisesMock.rename.mockResolvedValue(undefined);
        fsPromisesMock.copyFile.mockResolvedValue(undefined);
        fsPromisesMock.unlink.mockResolvedValue(undefined);
        spawnMock.mockImplementation(() => createProcess(0));
        repository.upsertSegment.mockReturnValue({ changes: 1 });
    });

    it('finalizes a stable partial into final MP4 and upserts the DB segment', async () => {
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

        expect(result).toMatchObject({ success: true, finalFilename: '20260511_211000.mp4' });
        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            '-i',
            'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            'C:\\recordings\\camera9\\20260511_211000.mp4.tmp',
        ]));
        expect(fsPromisesMock.rename).toHaveBeenCalledWith(
            'C:\\recordings\\camera9\\20260511_211000.mp4.tmp',
            'C:\\recordings\\camera9\\20260511_211000.mp4'
        );
        expect(repository.upsertSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 9,
            filename: '20260511_211000.mp4',
            duration: 240,
            filePath: 'C:\\recordings\\camera9\\20260511_211000.mp4',
        }));
        expect(diagnostics.clearDiagnostic).toHaveBeenCalledWith({ cameraId: 9, filename: '20260511_211000.mp4' });
    });

    it('serializes duplicate finalization requests for the same camera and final filename', async () => {
        const { createRecordingSegmentFinalizer } = await import('../services/recordingSegmentFinalizer.js');
        const finalizer = createRecordingSegmentFinalizer({
            recordingsBasePath: 'C:\\recordings',
            repository,
            diagnosticsRepository: diagnostics,
            stabilityDelayMs: 100,
        });

        const first = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        const second = finalizer.finalizeSegment({
            cameraId: 9,
            sourcePath: 'C:\\recordings\\camera9\\pending\\20260511_211000.mp4.partial',
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        });
        await vi.advanceTimersByTimeAsync(101);
        await Promise.all([first, second]);

        expect(spawnMock).toHaveBeenCalledTimes(1);
        expect(repository.upsertSegment).toHaveBeenCalledTimes(1);
    });

    it('records retryable diagnostic when ffprobe returns zero duration', async () => {
        execMock[promisify.custom] = vi.fn(async () => ({ stdout: '0\n', stderr: '' }));
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

        expect(result).toMatchObject({ success: false, reason: 'invalid_duration' });
        expect(repository.upsertSegment).not.toHaveBeenCalled();
        expect(diagnostics.upsertDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 9,
            filename: '20260511_211000.mp4',
            state: 'retryable_failed',
            reason: 'invalid_duration',
        }));
    });
});
```

- [ ] **Step 2: Run finalizer test to verify it fails**

Run: `cd backend && npm test -- recordingSegmentFinalizer.test.js`

Expected: FAIL because `recordingSegmentFinalizer.js` does not exist.

- [ ] **Step 3: Implement finalizer service**

```javascript
// Purpose: Finalize pending/orphan MP4 recordings into validated playback-ready segment rows.
// Caller: recordingService scanner, FFmpeg close handling, startup recovery, and shutdown drain.
// Deps: fs promises, child_process, recordingSegmentFilePolicy, segment repository, diagnostics repository.
// MainFuncs: createRecordingSegmentFinalizer, finalizeSegment, drain.
// SideEffects: Probes/remuxes/renames recording files and writes recording segment/diagnostic rows.

import { exec, spawn } from 'child_process';
import { promises as fsPromises } from 'fs';
import { promisify } from 'util';
import recordingSegmentRepository from './recordingSegmentRepository.js';
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
import {
    getFinalRecordingPath,
    getTempRecordingPath,
    parseSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';

const execPromise = promisify(exec);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseDuration(stdout) {
    const duration = Math.round(parseFloat(String(stdout || '').trim()));
    return Number.isFinite(duration) && duration >= 1 ? duration : null;
}

async function probeDuration(filePath) {
    const { stdout } = await execPromise(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { encoding: 'utf8', timeout: 5000 }
    );
    return parseDuration(stdout);
}

async function remuxToTemp(sourcePath, tempPath) {
    await new Promise((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
            '-i', sourcePath,
            '-c', 'copy',
            '-movflags', '+faststart',
            '-fflags', '+genpts',
            '-avoid_negative_ts', 'make_zero',
            '-y',
            tempPath,
        ]);

        let stderr = '';
        ffmpeg.stderr?.on('data', (chunk) => {
            if (stderr.length < 10000) {
                stderr += chunk.toString();
            }
        });
        ffmpeg.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(`ffmpeg remux failed with code ${code}: ${stderr.slice(-500)}`));
        });
        ffmpeg.on('error', reject);
    });
}

export function createRecordingSegmentFinalizer({
    recordingsBasePath,
    repository = recordingSegmentRepository,
    diagnosticsRepository = recordingRecoveryDiagnosticsRepository,
    stabilityDelayMs = 10000,
} = {}) {
    const inFlight = new Map();

    async function ensureStableFile(filePath) {
        const first = await fsPromises.stat(filePath);
        await sleep(stabilityDelayMs);
        const second = await fsPromises.stat(filePath);
        if (first.size !== second.size) {
            return { stable: false, size: second.size, mtimeMs: second.mtimeMs };
        }
        return { stable: true, size: second.size, mtimeMs: second.mtimeMs };
    }

    async function promoteTemp(tempPath, finalPath) {
        try {
            await fsPromises.rename(tempPath, finalPath);
        } catch (error) {
            if (error.code !== 'EXDEV') {
                throw error;
            }
            await fsPromises.copyFile(tempPath, finalPath);
            await fsPromises.unlink(tempPath);
        }
    }

    async function finalizeInternal({ cameraId, sourcePath, filename, sourceType = 'partial' }) {
        const parsed = parseSegmentFilename(filename);
        const finalFilename = parsed?.finalFilename ?? toFinalSegmentFilename(filename);
        if (!parsed || !finalFilename) {
            return { success: false, reason: 'invalid_filename' };
        }

        const finalPath = getFinalRecordingPath(recordingsBasePath, cameraId, finalFilename);
        const tempPath = getTempRecordingPath(recordingsBasePath, cameraId, finalFilename);
        const detectedAt = new Date().toISOString();

        try {
            await fsPromises.access(sourcePath);
            const stable = await ensureStableFile(sourcePath);
            if (!stable.stable) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: sourcePath,
                    state: 'pending',
                    reason: 'file_still_changing',
                    fileSize: stable.size,
                    detectedAt,
                });
                return { success: false, reason: 'file_still_changing', finalFilename };
            }

            const sourceDuration = await probeDuration(sourcePath);
            if (!sourceDuration) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: sourcePath,
                    state: 'retryable_failed',
                    reason: 'invalid_duration',
                    fileSize: stable.size,
                    detectedAt,
                });
                return { success: false, reason: 'invalid_duration', finalFilename };
            }

            if (sourcePath !== finalPath || sourceType !== 'final_orphan') {
                await remuxToTemp(sourcePath, tempPath);
                const tempDuration = await probeDuration(tempPath);
                if (!tempDuration) {
                    diagnosticsRepository.upsertDiagnostic({
                        cameraId,
                        filename: finalFilename,
                        filePath: tempPath,
                        state: 'retryable_failed',
                        reason: 'remux_invalid_duration',
                        fileSize: stable.size,
                        detectedAt,
                    });
                    return { success: false, reason: 'remux_invalid_duration', finalFilename };
                }
                await promoteTemp(tempPath, finalPath);
            }

            const finalStats = await fsPromises.stat(finalPath);
            const duration = await probeDuration(finalPath);
            if (!duration) {
                diagnosticsRepository.upsertDiagnostic({
                    cameraId,
                    filename: finalFilename,
                    filePath: finalPath,
                    state: 'retryable_failed',
                    reason: 'final_invalid_duration',
                    fileSize: finalStats.size,
                    detectedAt,
                });
                return { success: false, reason: 'final_invalid_duration', finalFilename };
            }

            repository.upsertSegment({
                cameraId,
                filename: finalFilename,
                startTime: parsed.timestamp.toISOString(),
                endTime: new Date(parsed.timestamp.getTime() + duration * 1000).toISOString(),
                fileSize: finalStats.size,
                duration,
                filePath: finalPath,
            });
            diagnosticsRepository.clearDiagnostic({ cameraId, filename: finalFilename });

            return { success: true, finalFilename, duration, filePath: finalPath };
        } catch (error) {
            diagnosticsRepository.upsertDiagnostic({
                cameraId,
                filename: finalFilename,
                filePath: sourcePath,
                state: 'retryable_failed',
                reason: error.message || 'finalize_failed',
                fileSize: 0,
                detectedAt,
            });
            return { success: false, reason: error.message || 'finalize_failed', finalFilename };
        }
    }

    function finalizeSegment(input) {
        const finalFilename = toFinalSegmentFilename(input.filename);
        const key = `${input.cameraId}:${finalFilename || input.filename}`;
        if (inFlight.has(key)) {
            return inFlight.get(key);
        }

        const promise = finalizeInternal(input).finally(() => {
            inFlight.delete(key);
        });
        inFlight.set(key, promise);
        return promise;
    }

    async function drain(timeoutMs = 30000) {
        const work = Promise.allSettled([...inFlight.values()]);
        const timeout = sleep(timeoutMs).then(() => 'timeout');
        const result = await Promise.race([work, timeout]);
        return {
            drained: result !== 'timeout',
            pending: inFlight.size,
        };
    }

    return { finalizeSegment, drain };
}

export default createRecordingSegmentFinalizer();
```

- [ ] **Step 4: Run finalizer tests**

Run: `cd backend && npm test -- recordingSegmentFinalizer.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingSegmentFinalizer.js backend/__tests__/recordingSegmentFinalizer.test.js
git commit -m "Add: recording segment finalizer"
```

---

### Task 4: FFmpeg Pending Output Wiring

**Files:**
- Modify: `backend/services/recordingService.js:329-351`
- Modify: `backend/services/recordingService.js:535-551`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing tests for pending output pattern**

Append to `backend/__tests__/recordingService.test.js` inside the existing `describe` block:

```javascript
    it('builds recording args with pending partial output pattern', async () => {
        const { buildRecordingFfmpegArgs } = await import('../services/recordingService.js');

        const args = buildRecordingFfmpegArgs({
            outputPattern: 'C:\\recordings\\camera1\\pending\\%Y%m%d_%H%M%S.mp4.partial',
            inputUrl: 'rtsp://user:pass@10.0.0.2/stream',
            streamSource: 'internal',
        });

        expect(args.at(-1)).toBe('C:\\recordings\\camera1\\pending\\%Y%m%d_%H%M%S.mp4.partial');
        expect(args).toContain('-segment_format');
        expect(args).toContain('mp4');
    });

    it('creates pending recording directory before starting recording', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue(createCamera({ id: 33 }));

        await recordingService.startRecording(33);

        expect(mkdirSyncMock).toHaveBeenCalledWith('C:\\project\\cctv\\recordings\\camera33\\pending', { recursive: true });
        expect(spawnMock).toHaveBeenCalledWith('ffmpeg', expect.arrayContaining([
            'C:\\project\\cctv\\recordings\\camera33\\pending\\%Y%m%d_%H%M%S.mp4.partial',
        ]));
    });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- recordingService.test.js -t "pending"`

Expected: FAIL because `buildRecordingFfmpegArgs` does not accept `outputPattern`, and start creates only camera dir.

- [ ] **Step 3: Update imports and FFmpeg args**

Change `backend/services/recordingService.js` imports:

```javascript
import {
    getCameraRecordingDir,
    getFinalRecordingPath,
    getPendingRecordingDir,
    getPendingRecordingPattern,
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

Replace `buildRecordingFfmpegArgs` signature/body:

```javascript
export function buildRecordingFfmpegArgs({ cameraDir, outputPattern, inputUrl, streamSource, rtspTransport = 'tcp' }) {
    const resolvedOutputPattern = outputPattern || join(cameraDir, '%Y%m%d_%H%M%S.mp4');
    const inputArgs = streamSource === 'external'
        ? [
            '-protocol_whitelist', EXTERNAL_RECORDING_PROTOCOL_WHITELIST,
            '-i', inputUrl,
        ]
        : buildFfmpegRtspInputArgs(inputUrl, rtspTransport);

    return [
        ...inputArgs,
        '-map', '0:v',
        '-c:v', 'copy',
        '-an',
        '-f', 'segment',
        '-segment_time', '600',
        '-segment_format', 'mp4',
        '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-segment_atclocktime', '1',
        '-reset_timestamps', '1',
        '-strftime', '1',
        resolvedOutputPattern,
    ];
}
```

Replace start directory creation block:

```javascript
            const cameraDir = getCameraRecordingDir(RECORDINGS_BASE_PATH, cameraId);
            const pendingDir = getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId);
            if (!existsSync(cameraDir)) {
                mkdirSync(cameraDir, { recursive: true });
            }
            if (!existsSync(pendingDir)) {
                mkdirSync(pendingDir, { recursive: true });
            }
```

Replace FFmpeg args creation:

```javascript
            const ffmpegArgs = buildRecordingFfmpegArgs({
                cameraDir,
                outputPattern: getPendingRecordingPattern(RECORDINGS_BASE_PATH, cameraId),
                inputUrl: sourceConfig.inputUrl,
                streamSource: sourceConfig.streamSource,
                rtspTransport: sourceConfig.rtspTransport,
            });
```

- [ ] **Step 4: Run focused tests**

Run: `cd backend && npm test -- recordingService.test.js -t "pending"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Add: pending recording output path"
```

---

### Task 5: Delegate Segment Creation to Finalizer

**Files:**
- Modify: `backend/services/recordingService.js:661-945`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing tests for `Closing` detection and delegation**

Add module mock near other mocks in `backend/__tests__/recordingService.test.js`:

```javascript
const finalizerMock = {
    finalizeSegment: vi.fn(),
    drain: vi.fn(),
};

vi.mock('../services/recordingSegmentFinalizer.js', () => ({
    default: finalizerMock,
}));
```

Append tests:

```javascript
    it('delegates partial segment closing to the finalizer', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');

        recordingService.handleRecordingStderr(
            5,
            "Opening 'C:\\recordings\\camera5\\pending\\20260511_211000.mp4.partial' for writing\nClosing segment"
        );

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 5,
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        }));
    });

    it('keeps duplicate partial close events idempotent through finalizer delegation', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');

        recordingService.onSegmentCreated(5, '20260511_211000.mp4.partial');
        recordingService.onSegmentCreated(5, '20260511_211000.mp4.partial');

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledTimes(1);
    });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- recordingService.test.js -t "partial segment"`

Expected: FAIL because current regex only matches `.mp4` and `onSegmentCreated` performs inline remux.

- [ ] **Step 3: Import finalizer and replace inline `onSegmentCreated` logic**

Add import:

```javascript
import recordingSegmentFinalizer from './recordingSegmentFinalizer.js';
```

Replace close detection in `handleRecordingStderr`:

```javascript
        if (output.includes('Closing') && output.includes('.mp4')) {
            const match = output.match(/(\d{8}_\d{6}\.mp4(?:\.partial)?)/);
            if (match) {
                const filename = match[1];
                console.log(`[FFmpeg] Detected segment completion (CLOSING): ${filename}`);
                this.onSegmentCreated(cameraId, filename);
            }
        }
```

Replace `onSegmentCreated` body with:

```javascript
    onSegmentCreated(cameraId, filename) {
        const finalFilename = toFinalSegmentFilename(filename);
        if (!finalFilename) {
            console.warn(`[Segment] Invalid filename format: ${filename}`);
            return;
        }

        if (isFileFailed(cameraId, finalFilename)) {
            const failedPath = getFinalRecordingPath(RECORDINGS_BASE_PATH, cameraId, finalFilename);
            if (existsSync(failedPath)) {
                quarantineFailedRemuxFileIfExpired(cameraId, finalFilename, failedPath, 'remux_failed_3x').catch((err) => {
                    console.error(`[Segment] Failed to process failed-remux file ${finalFilename}:`, err.message);
                });
            }
            return;
        }

        const fileKey = `${cameraId}:${finalFilename}`;
        if (filesBeingProcessed.has(fileKey)) {
            console.log(`[Segment] Already processing: ${finalFilename}, skipping duplicate`);
            return;
        }

        filesBeingProcessed.add(fileKey);
        const sourceType = isPartialSegmentFilename(filename) ? 'partial' : 'final_orphan';
        const sourcePath = sourceType === 'partial'
            ? join(getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId), filename)
            : getFinalRecordingPath(RECORDINGS_BASE_PATH, cameraId, finalFilename);

        console.log(`[Segment] Enqueue finalization: camera${cameraId}/${filename}`);
        recordingSegmentFinalizer.finalizeSegment({
            cameraId,
            sourcePath,
            filename,
            sourceType,
        }).finally(() => {
            filesBeingProcessed.delete(fileKey);
        });
    }
```

- [ ] **Step 4: Run focused tests**

Run: `cd backend && npm test -- recordingService.test.js -t "partial segment"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Refactor: delegate recording segment finalization"
```

---

### Task 6: Startup and Interval Recovery Scanner

**Files:**
- Modify: `backend/services/recordingService.js:1119-1232`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing scanner recovery tests**

Append tests:

```javascript
    it('scanner recovers pending partial files that are not registered', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['pending'];
            if (targetPath.endsWith('pending')) return ['20260511_211000.mp4.partial'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8') || targetPath.endsWith('pending'),
            size: 4096,
            mtimeMs: Date.now() - 120000,
        }));

        recordingService.startSegmentScanner((callback) => {
            callback();
            return 1;
        });
        await Promise.resolve();

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 8,
            filename: '20260511_211000.mp4.partial',
            sourceType: 'partial',
        }));
    });

    it('scanner reconciles valid final orphan MP4 files into DB through finalizer', async () => {
        finalizerMock.finalizeSegment.mockResolvedValue({ success: true });
        const { recordingService } = await import('../services/recordingService.js');
        queryOneMock.mockReturnValue({ id: 8, enable_recording: 1 });
        queryMock.mockReturnValue([]);
        fsPromisesMock.readdir.mockImplementation(async (targetPath) => {
            if (targetPath.endsWith('recordings')) return ['camera8'];
            if (targetPath.endsWith('camera8')) return ['20260511_211000.mp4'];
            return [];
        });
        fsPromisesMock.stat.mockImplementation(async (targetPath) => ({
            isDirectory: () => targetPath.endsWith('camera8'),
            size: 4096,
            mtimeMs: Date.now() - 120000,
        }));

        recordingService.startSegmentScanner((callback) => {
            callback();
            return 1;
        });
        await Promise.resolve();

        expect(finalizerMock.finalizeSegment).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 8,
            filename: '20260511_211000.mp4',
            sourceType: 'final_orphan',
        }));
    });
```

- [ ] **Step 2: Run tests to verify failure**

Run: `cd backend && npm test -- recordingService.test.js -t "scanner recovers|scanner reconciles"`

Expected: FAIL because scanner only scans final `.mp4` files in camera directory.

- [ ] **Step 3: Replace scanner file collection with pending+final recovery**

Inside `startSegmentScanner`, replace per-camera file listing and loop with:

```javascript
                        const allFiles = await fsPromises.readdir(cameraDir);
                        const finalFiles = allFiles.filter(isFinalSegmentFilename);
                        let partialFiles = [];
                        const pendingDir = getPendingRecordingDir(RECORDINGS_BASE_PATH, cameraId);
                        try {
                            partialFiles = (await fsPromises.readdir(pendingDir)).filter(isPartialSegmentFilename);
                        } catch {
                            partialFiles = [];
                        }

                        const existingFilesSet = new Set(
                            query('SELECT filename FROM recording_segments WHERE camera_id = ?', [cameraId])
                                .map(row => row.filename)
                        );

                        for (const filename of partialFiles) {
                            const finalFilename = toFinalSegmentFilename(filename);
                            if (!finalFilename || existingFilesSet.has(finalFilename)) continue;
                            const filePath = join(pendingDir, filename);
                            const stats = await fsPromises.stat(filePath);
                            const fileAge = Date.now() - stats.mtimeMs;
                            const fileKey = `${cameraId}:${finalFilename}`;
                            if (filesBeingProcessed.has(fileKey)) continue;
                            if (fileAge > 30000) {
                                console.log(`[Scanner] Found pending segment: ${filename} (age: ${Math.round(fileAge / 1000)}s)`);
                                this.onSegmentCreated(cameraId, filename);
                            }
                        }

                        for (const filename of finalFiles) {
                            if (isFileFailed(cameraId, filename)) {
                                const failedPath = join(cameraDir, filename);
                                try {
                                    await fsPromises.access(failedPath);
                                    const quarantineResult = await quarantineFailedRemuxFileIfExpired(cameraId, filename, failedPath, 'scanner_remux_failed_3x');
                                    if (!quarantineResult.retained) {
                                        console.log(`[Scanner] Quarantined expired failed-remux file: ${filename}`);
                                    }
                                } catch {
                                    removeFailedFile(cameraId, filename);
                                }
                                continue;
                            }

                            if (!existingFilesSet.has(filename)) {
                                const filePath = join(cameraDir, filename);
                                const stats = await fsPromises.stat(filePath);
                                const fileKey = `${cameraId}:${filename}`;
                                if (filesBeingProcessed.has(fileKey)) continue;
                                const fileAge = Date.now() - stats.mtimeMs;
                                if (fileAge > 30000) {
                                    console.log(`[Scanner] Found unregistered final segment: ${filename} (age: ${Math.round(fileAge / 1000)}s)`);
                                    this.onSegmentCreated(cameraId, filename);
                                }
                            }
                        }
```

- [ ] **Step 4: Run focused tests**

Run: `cd backend && npm test -- recordingService.test.js -t "scanner recovers|scanner reconciles"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Add: recording startup recovery scanner"
```

---

### Task 7: Shutdown Drain for PM2 Restart

**Files:**
- Modify: `backend/services/recordingService.js:1094-1098`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing shutdown drain test**

Append test:

```javascript
    it('drains segment finalizer during shutdown after stopping ffmpeg', async () => {
        finalizerMock.drain.mockResolvedValue({ drained: true, pending: 0 });
        const { recordingService } = await import('../services/recordingService.js');
        const child = createSpawnProcess();
        spawnMock.mockReturnValue(child);
        queryOneMock.mockReturnValue(createCamera({ id: 44 }));

        await recordingService.startRecording(44);
        const shutdownPromise = recordingService.shutdown();
        child.emit('close', 255, null);
        await shutdownPromise;

        expect(finalizerMock.drain).toHaveBeenCalledWith(30000);
    });
```

- [ ] **Step 2: Run test to verify failure**

Run: `cd backend && npm test -- recordingService.test.js -t "drains segment finalizer"`

Expected: FAIL because shutdown does not call finalizer drain.

- [ ] **Step 3: Update shutdown**

Replace `shutdown()` with:

```javascript
    async shutdown() {
        this.isShuttingDown = true;
        this.scheduler?.stop();
        const results = await recordingProcessManager.shutdownAll('server_shutdown');
        const drainResult = await recordingSegmentFinalizer.drain(30000);
        if (!drainResult.drained) {
            console.warn(`[Shutdown] Recording finalizer drain timed out with ${drainResult.pending} pending file(s)`);
        }
        return results;
    }
```

- [ ] **Step 4: Run focused test**

Run: `cd backend && npm test -- recordingService.test.js -t "drains segment finalizer"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingService.js backend/__tests__/recordingService.test.js
git commit -m "Fix: drain recording finalizer on shutdown"
```

---

### Task 8: Cleanup Recovery Safety

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add failing cleanup safety tests**

Add tests to `backend/__tests__/recordingCleanupService.test.js`:

```javascript
    it('does not delete pending partial files inside retention grace', async () => {
        const service = createRecordingCleanupService({
            repository,
            fsPromises: fsPromisesMock,
            recordingsBasePath: 'C:\\recordings',
        });
        fsPromisesMock.readdir.mockResolvedValue(['pending']);
        fsPromisesMock.stat.mockResolvedValue({
            isDirectory: () => true,
            size: 4096,
            mtimeMs: Date.now() - 20 * 60 * 1000,
        });

        await service.cleanupCamera({
            cameraId: 5,
            camera: { recording_duration_hours: 1 },
            nowMs: Date.now(),
        });

        expect(fsPromisesMock.unlink).not.toHaveBeenCalledWith(expect.stringContaining('.partial'));
    });

    it('attempts registration before deleting final orphan files', async () => {
        const service = createRecordingCleanupService({
            repository,
            fsPromises: fsPromisesMock,
            recordingsBasePath: 'C:\\recordings',
            onRecoverOrphan: vi.fn(),
        });
        repository.listFilenamesByCamera.mockReturnValue([]);
        fsPromisesMock.readdir.mockResolvedValue(['20260511_211000.mp4']);
        fsPromisesMock.stat.mockResolvedValue({
            isDirectory: () => false,
            size: 4096,
            mtimeMs: Date.now() - 20 * 60 * 1000,
        });

        await service.cleanupCamera({
            cameraId: 5,
            camera: { recording_duration_hours: 1 },
            nowMs: Date.now(),
        });

        expect(fsPromisesMock.unlink).not.toHaveBeenCalled();
    });
```

- [ ] **Step 2: Run cleanup tests to verify failure**

Run: `cd backend && npm test -- recordingCleanupService.test.js`

Expected: FAIL where cleanup does not know pending/final orphan recovery rules.

- [ ] **Step 3: Update cleanup policy**

In `recordingCleanupService.js`, import policy helpers:

```javascript
import {
    isFinalSegmentFilename,
    isPartialSegmentFilename,
    isTempSegmentFilename,
    toFinalSegmentFilename,
} from './recordingSegmentFilePolicy.js';
```

Add explicit guard before deleting filesystem orphans:

```javascript
function shouldRetainRecoveryFile({ filename, fileAgeMs, retentionWindow }) {
    const finalFilename = toFinalSegmentFilename(filename);
    if (!finalFilename) {
        return false;
    }

    if (isPartialSegmentFilename(filename) || isTempSegmentFilename(filename)) {
        return fileAgeMs <= retentionWindow.retentionMs + retentionWindow.graceMs;
    }

    if (isFinalSegmentFilename(filename)) {
        return fileAgeMs <= retentionWindow.retentionMs + retentionWindow.graceMs;
    }

    return false;
}
```

Apply it in orphan cleanup before unlink:

```javascript
                if (shouldRetainRecoveryFile({ filename, fileAgeMs: ageMs, retentionWindow })) {
                    console.log(`[Cleanup] Retaining recovery candidate until retention expiry: camera${cameraId}/${filename}`);
                    continue;
                }
```

- [ ] **Step 4: Run cleanup tests**

Run: `cd backend && npm test -- recordingCleanupService.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingCleanupService.js backend/__tests__/recordingCleanupService.test.js
git commit -m "Fix: retain recording recovery files during cleanup"
```

---

### Task 9: Assurance Diagnostics Visibility

**Files:**
- Modify: `backend/services/recordingAssuranceService.js`
- Modify: `backend/__tests__/recordingAssuranceService.test.js`

- [ ] **Step 1: Add failing assurance test**

Add repository mock and test:

```javascript
vi.mock('../services/recordingRecoveryDiagnosticsRepository.js', () => ({
    default: {
        summarizeActive: vi.fn(() => ({ pending: 2, retryable_failed: 1, unrecoverable: 1 })),
    },
}));

it('includes recovery diagnostic summary in assurance snapshot', async () => {
    const service = (await import('../services/recordingAssuranceService.js')).default;
    const snapshot = service.getSnapshot();

    expect(snapshot.recoveryDiagnostics).toEqual({
        pending: 2,
        retryable_failed: 1,
        unrecoverable: 1,
    });
});
```

- [ ] **Step 2: Run assurance test to verify failure**

Run: `cd backend && npm test -- recordingAssuranceService.test.js -t "recovery diagnostic"`

Expected: FAIL because snapshot does not expose recovery diagnostics.

- [ ] **Step 3: Add diagnostics summary to assurance service**

Import repository:

```javascript
import recordingRecoveryDiagnosticsRepository from './recordingRecoveryDiagnosticsRepository.js';
```

Add to returned snapshot object:

```javascript
            recoveryDiagnostics: recordingRecoveryDiagnosticsRepository.summarizeActive(),
```

- [ ] **Step 4: Run focused test**

Run: `cd backend && npm test -- recordingAssuranceService.test.js -t "recovery diagnostic"`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingAssuranceService.js backend/__tests__/recordingAssuranceService.test.js
git commit -m "Add: recording recovery diagnostics summary"
```

---

### Task 10: Module Map and Full Verification

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update service module map**

In `backend/services/.module_map.md`, update Recording domain bullets to include:

```markdown
  - `recordingSegmentFilePolicy.js`: pure path/name classifier for final, partial, temp, and recovery segment files.
  - `recordingSegmentFinalizer.js`: idempotent finalization pipeline for pending/orphan MP4 files; validates duration, remuxes to temp, atomically promotes final MP4, upserts DB, and records diagnostics.
  - `recordingRecoveryDiagnosticsRepository.js`: DB access for operator-visible recovery states (`pending`, `retryable_failed`, `unrecoverable`) when files exist but are not playback-ready.
  - Recording recovery invariant: playback only reads validated final MP4 rows from `recording_segments`; pending/partial/tmp/corrupt/orphan files are retained through retention+grace and reconciled before deletion.
```

- [ ] **Step 2: Run migration and focused recording tests**

Run:

```bash
cd backend && npm run migrate && npm test -- recordingSegmentFilePolicy.test.js recordingRecoveryDiagnosticsRepository.test.js recordingSegmentFinalizer.test.js recordingService.test.js recordingCleanupService.test.js recordingAssuranceService.test.js
```

Expected: migration succeeds; all listed tests PASS.

- [ ] **Step 3: Run full backend tests**

Run: `cd backend && npm test`

Expected: PASS.

- [ ] **Step 4: Check git status**

Run: `git status --short`

Expected: only planned backend files and tests are modified.

- [ ] **Step 5: Commit docs/map update**

```bash
git add backend/services/.module_map.md
git commit -m "Docs: document recording recovery pipeline"
```

- [ ] **Step 6: Push branch**

Run: `git push`

Expected: current branch pushed successfully.

---

## Self-Review

- Spec coverage: PM2 restart is covered by shutdown drain; power loss is covered by startup scanner and idempotent finalizer; hidden `00` files are covered by diagnostics; cleanup safety is covered by retention-aware recovery file guards.
- Placeholder scan: no unresolved placeholder markers; code steps include concrete snippets and commands.
- Type consistency: finalizer uses `cameraId`, `filename`, `sourcePath`, `sourceType`; policy consistently returns `finalFilename`; diagnostics states use `pending`, `retryable_failed`, and `unrecoverable`.
- Residual risk: Phase 1 cannot repair every MP4 with missing metadata after a hard crash. The fail-safe behavior is explicit retention plus diagnostics, not forced playback of corrupt files.
