<!--
Purpose: Implementation plan for safe recording auto-resume lifecycle reconciliation.
Caller: Agents and maintainers executing the recording auto-resume hardening work.
Deps: docs/superpowers/specs/2026-05-17-recording-auto-resume-lifecycle-reconciler-design.md, backend services maps, Vitest.
MainFuncs: Breaks the reconciler implementation into TDD tasks with exact files, commands, and verification gates.
SideEffects: Documentation only; no runtime behavior changes until this plan is executed.
-->

# Recording Auto-Resume Lifecycle Reconciler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make recording resume automatically when an enabled recordable camera comes back online after minutes or hours offline, even if the exact health transition was missed.

**Architecture:** Add a pure lifecycle policy and a side-effecting reconciler that compares desired camera state from SQLite with actual FFmpeg process state. Keep `recordingService.js` as the facade, route health/runtime/startup/periodic triggers through the reconciler, and do not change cleanup, retention, recovery scanner, finalizer, or file operation services.

**Tech Stack:** Node.js 20+, ES modules, Fastify service layer, SQLite via `connectionPool`, Vitest with mocked services and fake timers.

---

## File Structure

- Create: `backend/services/recordingLifecyclePolicy.js`
  - Responsibility: pure decision logic only.
  - No DB, filesystem, process, timer, or service singleton imports.
- Create: `backend/__tests__/recordingLifecyclePolicy.test.js`
  - Responsibility: exhaustive action matrix for eligible, disabled, offline, cooldown, and already-running cameras.
- Create: `backend/services/recordingLifecycleReconciler.js`
  - Responsibility: read desired camera state, compare with `recordingProcessManager`, and delegate to `recordingService`.
  - No cleanup/delete/quarantine imports.
- Create: `backend/__tests__/recordingLifecycleReconciler.test.js`
  - Responsibility: side-effect orchestration, single-flight guard, and `reconcileAll()` failure isolation.
- Modify: `backend/services/recordingService.js`
  - Responsibility: expose reconciler facade methods and start periodic reconciliation through the existing scheduler.
- Modify: `backend/__tests__/recordingService.test.js`
  - Responsibility: prove periodic reconciler catches a stopped online camera even when no `streamHealthMap` entry exists.
- Modify: `backend/services/cameraHealthService.js`
  - Responsibility: trigger lifecycle reconciliation from online status transitions and runtime online signals.
- Modify: `backend/__tests__/cameraHealthService.test.js`
  - Responsibility: prove runtime online signals trigger recording reconciliation without embedding process logic in health.
- Modify: `backend/services/recordingScheduler.js`
  - Responsibility: schedule lifecycle reconciler timer beside scanner/cleanup timers.
- Modify: `backend/services/.module_map.md`
  - Responsibility: document new ownership boundaries.

DB justification: no migration is needed. `reconcileAll()` uses one low-frequency query against `cameras` filtered by existing enabled/recording flags, then only starts/stops cameras whose process state requires action.

---

### Task 1: Pure Lifecycle Policy

**Files:**
- Create: `backend/services/recordingLifecyclePolicy.js`
- Create: `backend/__tests__/recordingLifecyclePolicy.test.js`

- [ ] **Step 1: Write the failing policy tests**

Create `backend/__tests__/recordingLifecyclePolicy.test.js`:

```javascript
/*
Purpose: Validate pure recording lifecycle desired-state decisions.
Caller: Vitest backend suite.
Deps: recordingLifecyclePolicy.
MainFuncs: decideRecordingLifecycleAction and isRecordableCamera tests.
SideEffects: None; pure unit tests.
*/

import { describe, expect, it } from 'vitest';
import {
    decideRecordingLifecycleAction,
    isRecordableCamera,
} from '../services/recordingLifecyclePolicy.js';

function camera(overrides = {}) {
    return {
        id: 1,
        enabled: 1,
        enable_recording: 1,
        is_online: 1,
        delivery_type: 'internal_hls',
        ...overrides,
    };
}

function status(overrides = {}) {
    return {
        status: 'stopped',
        isRecording: false,
        ...overrides,
    };
}

describe('recordingLifecyclePolicy', () => {
    it('treats only enabled recordable HLS cameras as recordable', () => {
        expect(isRecordableCamera(camera())).toBe(true);
        expect(isRecordableCamera(camera({ delivery_type: 'external_hls' }))).toBe(true);
        expect(isRecordableCamera(camera({ delivery_type: 'external_mjpeg' }))).toBe(false);
        expect(isRecordableCamera(camera({ enabled: 0 }))).toBe(false);
        expect(isRecordableCamera(camera({ enable_recording: 0 }))).toBe(false);
    });

    it('starts a stopped eligible online camera', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 0, suspendedReason: null },
            now: 1000,
        })).toMatchObject({
            action: 'start',
            clearCooldown: true,
            reason: 'eligible_online_stopped',
        });
    });

    it('waits during non-offline cooldown instead of starting immediately', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 5000, suspendedReason: 'waiting_retry' },
            now: 1000,
        })).toMatchObject({
            action: 'wait_cooldown',
            reason: 'cooldown_active',
        });
    });

    it('allows an offline suspension to clear when the camera is online again', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status(),
            recordingStatus: { cooldownUntil: 5000, suspendedReason: 'camera_offline' },
            now: 1000,
        })).toMatchObject({
            action: 'start',
            clearCooldown: true,
            reason: 'camera_back_online',
        });
    });

    it('stops a running process when the camera is offline', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera({ is_online: 0 }),
            processStatus: status({ status: 'recording', isRecording: true }),
            recordingStatus: {},
            now: 1000,
        })).toMatchObject({
            action: 'stop_offline',
            reason: 'camera_offline',
        });
    });

    it('does nothing for disabled, unrecordable, offline-stopped, and already-recording cameras', () => {
        expect(decideRecordingLifecycleAction({
            camera: camera({ enabled: 0 }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_disabled');

        expect(decideRecordingLifecycleAction({
            camera: camera({ delivery_type: 'external_mjpeg' }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_unrecordable');

        expect(decideRecordingLifecycleAction({
            camera: camera({ is_online: 0 }),
            processStatus: status(),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_not_online');

        expect(decideRecordingLifecycleAction({
            camera: camera(),
            processStatus: status({ status: 'recording', isRecording: true }),
            recordingStatus: {},
            now: 1000,
        }).action).toBe('noop_recording');
    });
});
```

- [ ] **Step 2: Run policy tests and confirm they fail**

Run:

```bash
cd backend
npm test -- recordingLifecyclePolicy.test.js
```

Expected: FAIL because `backend/services/recordingLifecyclePolicy.js` does not exist.

- [ ] **Step 3: Implement the pure policy**

Create `backend/services/recordingLifecyclePolicy.js`:

```javascript
// Purpose: Decide desired recording lifecycle actions from camera and process state.
// Caller: recordingLifecycleReconciler and focused policy tests.
// Deps: None.
// MainFuncs: isRecordableCamera, decideRecordingLifecycleAction.
// SideEffects: None; pure policy only.

const RECORDABLE_DELIVERY_TYPES = new Set(['internal_hls', 'external_hls']);

function isEnabled(value) {
    return value === 1 || value === true;
}

function isStopped(processStatus = {}) {
    return !processStatus || processStatus.status === 'stopped' || processStatus.isRecording === false;
}

export function isRecordableCamera(camera = {}) {
    return isEnabled(camera.enabled)
        && isEnabled(camera.enable_recording)
        && RECORDABLE_DELIVERY_TYPES.has(camera.delivery_type);
}

export function decideRecordingLifecycleAction({
    camera,
    processStatus = {},
    recordingStatus = {},
    now = Date.now(),
} = {}) {
    if (!camera) {
        return { action: 'noop_missing', reason: 'camera_missing' };
    }

    if (!isEnabled(camera.enabled) || !isEnabled(camera.enable_recording)) {
        return { action: 'noop_disabled', reason: 'camera_or_recording_disabled' };
    }

    if (!RECORDABLE_DELIVERY_TYPES.has(camera.delivery_type)) {
        return { action: 'noop_unrecordable', reason: 'delivery_not_recordable' };
    }

    if (!isEnabled(camera.is_online)) {
        if (!isStopped(processStatus)) {
            return { action: 'stop_offline', reason: 'camera_offline' };
        }
        return { action: 'noop_not_online', reason: 'camera_offline_stopped' };
    }

    if (!isStopped(processStatus)) {
        return { action: 'noop_recording', reason: 'already_recording' };
    }

    const cooldownUntil = Number(recordingStatus.cooldownUntil || 0);
    const suspendedReason = recordingStatus.suspendedReason || null;

    if (cooldownUntil > now && suspendedReason !== 'camera_offline') {
        return {
            action: 'wait_cooldown',
            reason: 'cooldown_active',
            cooldownUntil,
            suspendedReason,
        };
    }

    return {
        action: 'start',
        reason: suspendedReason === 'camera_offline'
            ? 'camera_back_online'
            : 'eligible_online_stopped',
        clearCooldown: suspendedReason === 'camera_offline' || suspendedReason === null,
    };
}
```

- [ ] **Step 4: Run policy tests and commit**

Run:

```bash
cd backend
npm test -- recordingLifecyclePolicy.test.js
```

Expected: PASS.

Commit:

```bash
git add backend/services/recordingLifecyclePolicy.js backend/__tests__/recordingLifecyclePolicy.test.js
git commit -m "Add: recording lifecycle policy"
```

---

### Task 2: Lifecycle Reconciler Service

**Files:**
- Create: `backend/services/recordingLifecycleReconciler.js`
- Create: `backend/__tests__/recordingLifecycleReconciler.test.js`

- [ ] **Step 1: Write failing reconciler tests**

Create `backend/__tests__/recordingLifecycleReconciler.test.js`:

```javascript
/*
Purpose: Validate recording lifecycle reconciler orchestration and safety guards.
Caller: Vitest backend suite.
Deps: recordingLifecycleReconciler with injected DB/process/service dependencies.
MainFuncs: reconcileCamera and reconcileAll behavior tests.
SideEffects: Uses mocks only; no real DB, process, or filesystem work.
*/

import { describe, expect, it, vi } from 'vitest';
import { createRecordingLifecycleReconciler } from '../services/recordingLifecycleReconciler.js';

function camera(overrides = {}) {
    return {
        id: 1,
        enabled: 1,
        enable_recording: 1,
        is_online: 1,
        delivery_type: 'internal_hls',
        ...overrides,
    };
}

function createDeps({ cameras = [camera()], processStatus = { status: 'stopped', isRecording: false } } = {}) {
    const byId = new Map(cameras.map((item) => [item.id, item]));
    return {
        query: vi.fn(() => cameras),
        queryOne: vi.fn((sql, params) => byId.get(params[0]) || null),
        recordingProcessManager: {
            getStatus: vi.fn(() => processStatus),
        },
        recordingService: {
            getRecordingStatus: vi.fn(() => ({ status: 'stopped', cooldownUntil: 0, suspendedReason: null })),
            handleCameraBecameOnline: vi.fn(() => Promise.resolve({ success: true })),
            handleCameraBecameOffline: vi.fn(() => Promise.resolve({ success: true })),
        },
        logger: {
            log: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        },
    };
}

describe('recordingLifecycleReconciler', () => {
    it('starts a stopped eligible online camera through the recording facade', async () => {
        const deps = createDeps();
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(1, 'periodic_safety_net', 1000);

        expect(result).toMatchObject({ cameraId: 1, action: 'start', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).toHaveBeenCalledWith(1, 1000, { clearCooldown: true });
        expect(deps.recordingService.handleCameraBecameOffline).not.toHaveBeenCalled();
    });

    it('suspends an active recording when the camera is offline', async () => {
        const deps = createDeps({
            cameras: [camera({ id: 2, is_online: 0 })],
            processStatus: { status: 'recording', isRecording: true },
        });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(2, 'health_offline', 1000);

        expect(result).toMatchObject({ cameraId: 2, action: 'stop_offline', success: true });
        expect(deps.recordingService.handleCameraBecameOffline).toHaveBeenCalledWith(2, 1000);
        expect(deps.recordingService.handleCameraBecameOnline).not.toHaveBeenCalled();
    });

    it('does nothing for unrecordable cameras', async () => {
        const deps = createDeps({ cameras: [camera({ id: 3, delivery_type: 'external_mjpeg' })] });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileCamera(3, 'periodic_safety_net', 1000);

        expect(result).toMatchObject({ cameraId: 3, action: 'noop_unrecordable', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).not.toHaveBeenCalled();
    });

    it('single-flights duplicate reconcile calls for the same camera', async () => {
        let resolveStart;
        const deps = createDeps();
        deps.recordingService.handleCameraBecameOnline.mockReturnValue(new Promise((resolve) => {
            resolveStart = resolve;
        }));
        const reconciler = createRecordingLifecycleReconciler(deps);

        const first = reconciler.reconcileCamera(1, 'runtime_online_signal', 1000);
        const second = await reconciler.reconcileCamera(1, 'runtime_online_signal', 1000);

        expect(second).toMatchObject({ cameraId: 1, action: 'skipped_in_flight', success: true });
        resolveStart({ success: true });
        expect(await first).toMatchObject({ cameraId: 1, action: 'start', success: true });
        expect(deps.recordingService.handleCameraBecameOnline).toHaveBeenCalledTimes(1);
    });

    it('continues reconcileAll after one camera fails', async () => {
        const deps = createDeps({ cameras: [camera({ id: 1 }), camera({ id: 2 })] });
        deps.recordingService.handleCameraBecameOnline
            .mockRejectedValueOnce(new Error('start failed'))
            .mockResolvedValueOnce({ success: true });
        const reconciler = createRecordingLifecycleReconciler(deps);

        const result = await reconciler.reconcileAll('periodic_safety_net', 1000);

        expect(result.checked).toBe(2);
        expect(result.results).toHaveLength(2);
        expect(result.results[0]).toMatchObject({ cameraId: 1, action: 'error', success: false });
        expect(result.results[1]).toMatchObject({ cameraId: 2, action: 'start', success: true });
    });
});
```

- [ ] **Step 2: Run reconciler tests and confirm they fail**

Run:

```bash
cd backend
npm test -- recordingLifecycleReconciler.test.js
```

Expected: FAIL because `backend/services/recordingLifecycleReconciler.js` does not exist.

- [ ] **Step 3: Implement reconciler without cleanup/delete dependencies**

Create `backend/services/recordingLifecycleReconciler.js`:

```javascript
// Purpose: Reconcile desired recording state against active FFmpeg process state.
// Caller: recordingService startup/periodic work and cameraHealthService online/offline signals.
// Deps: connectionPool, recordingLifecyclePolicy, recordingService facade, recordingProcessManager.
// MainFuncs: createRecordingLifecycleReconciler, reconcileCamera, reconcileAll.
// SideEffects: Reads camera DB state and delegates recording start/stop; does not delete or quarantine files.

import { query as defaultQuery, queryOne as defaultQueryOne } from '../database/connectionPool.js';
import { decideRecordingLifecycleAction } from './recordingLifecyclePolicy.js';

const CAMERA_SELECT = `
    SELECT id, enabled, enable_recording, is_online, delivery_type, stream_source,
           private_rtsp_url, external_hls_url, recording_status
    FROM cameras
`;

export function createRecordingLifecycleReconciler({
    query = defaultQuery,
    queryOne = defaultQueryOne,
    recordingService,
    recordingProcessManager,
    logger = console,
} = {}) {
    if (!recordingService) {
        throw new Error('recordingService dependency is required');
    }
    if (!recordingProcessManager) {
        throw new Error('recordingProcessManager dependency is required');
    }

    const inFlight = new Set();

    async function applyDecision(camera, decision, now) {
        if (decision.action === 'start') {
            const result = await recordingService.handleCameraBecameOnline(camera.id, now, {
                clearCooldown: decision.clearCooldown,
            });
            return { cameraId: camera.id, action: decision.action, success: result?.success !== false, decision, result };
        }

        if (decision.action === 'stop_offline') {
            const result = await recordingService.handleCameraBecameOffline(camera.id, now);
            return { cameraId: camera.id, action: decision.action, success: result?.success !== false, decision, result };
        }

        return { cameraId: camera.id, action: decision.action, success: true, decision };
    }

    async function reconcileCameraSnapshot(camera, reason = 'periodic_safety_net', now = Date.now()) {
        const cameraId = camera?.id;
        if (!cameraId) {
            return { cameraId: null, action: 'noop_missing', success: true, reason };
        }

        if (inFlight.has(cameraId)) {
            return { cameraId, action: 'skipped_in_flight', success: true, reason };
        }

        inFlight.add(cameraId);
        try {
            const processStatus = recordingProcessManager.getStatus(cameraId);
            const recordingStatus = recordingService.getRecordingStatus(cameraId);
            const decision = decideRecordingLifecycleAction({
                camera,
                processStatus,
                recordingStatus,
                now,
            });
            const result = await applyDecision(camera, decision, now);
            return { ...result, reason };
        } catch (error) {
            logger.error?.(`[RecordingReconciler] Failed to reconcile camera ${cameraId}:`, error.message);
            return { cameraId, action: 'error', success: false, reason, error: error.message };
        } finally {
            inFlight.delete(cameraId);
        }
    }

    async function reconcileCamera(cameraId, reason = 'manual', now = Date.now()) {
        const camera = queryOne(`${CAMERA_SELECT} WHERE id = ?`, [cameraId]);
        if (!camera) {
            return { cameraId, action: 'noop_missing', success: true, reason: 'camera_missing' };
        }
        return reconcileCameraSnapshot(camera, reason, now);
    }

    async function reconcileAll(reason = 'periodic_safety_net', now = Date.now()) {
        const cameras = query(`${CAMERA_SELECT} WHERE enabled = 1 AND enable_recording = 1 ORDER BY id ASC`);
        const results = [];
        for (const camera of cameras) {
            results.push(await reconcileCameraSnapshot(camera, reason, now));
        }
        return { success: true, checked: cameras.length, results };
    }

    function isInFlight(cameraId) {
        return inFlight.has(cameraId);
    }

    return { reconcileCamera, reconcileAll, isInFlight };
}
```

- [ ] **Step 4: Run reconciler tests and destructive-path audit**

Run:

```bash
cd backend
npm test -- recordingLifecyclePolicy.test.js recordingLifecycleReconciler.test.js
```

Expected: PASS.

Run from repo root:

```bash
rg -n "deleteFileSafely|quarantineFile|unlink|cleanup|removeFile" backend/services/recordingLifecyclePolicy.js backend/services/recordingLifecycleReconciler.js
```

Expected: no output. This proves the new lifecycle files do not introduce delete/quarantine behavior.

- [ ] **Step 5: Commit**

```bash
git add backend/services/recordingLifecyclePolicy.js backend/services/recordingLifecycleReconciler.js backend/__tests__/recordingLifecyclePolicy.test.js backend/__tests__/recordingLifecycleReconciler.test.js
git commit -m "Add: recording lifecycle reconciler"
```

---

### Task 3: Recording Service Integration And Periodic Safety Net

**Files:**
- Modify: `backend/services/recordingService.js`
- Modify: `backend/services/recordingScheduler.js`
- Modify: `backend/__tests__/recordingService.test.js`

- [ ] **Step 1: Add failing recording service coverage**

In `backend/__tests__/recordingService.test.js`, add this test near existing recording health lifecycle tests:

```javascript
    it('periodic lifecycle reconciliation starts a stopped online camera missing from stream health state', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const camera = createCamera({
            id: 91,
            delivery_type: 'internal_hls',
            is_online: 1,
            enable_recording: 1,
            enabled: 1,
        });

        queryMock.mockReturnValue([camera]);
        queryOneMock.mockImplementation((sql) => {
            if (sql.includes('SELECT id, enabled, enable_recording, is_online, delivery_type')) {
                return camera;
            }
            if (sql.includes('SELECT * FROM cameras')) {
                return camera;
            }
            return null;
        });

        expect(recordingService.getRecordingStatus(91)).toMatchObject({ status: 'stopped' });

        const result = await recordingService.reconcileRecordingLifecycleAll('test_periodic', 1000);

        expect(result).toMatchObject({ success: true, checked: 1 });
        expect(recordingService.getRecordingStatus(91)).toMatchObject({
            isRecording: true,
            status: 'recording',
        });
        expect(spawnMock).toHaveBeenCalledTimes(1);
    });
```

Add this scheduler test to the same file:

```javascript
    it('starts lifecycle reconciliation through the recording scheduler', async () => {
        const { recordingService } = await import('../services/recordingService.js');
        const scheduleTimeout = vi.fn();

        recordingService.startLifecycleReconciler(scheduleTimeout);

        expect(scheduleTimeout).toHaveBeenCalledWith(expect.any(Function), 60000);
    });
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
cd backend
npm test -- recordingService.test.js -t "periodic lifecycle reconciliation|lifecycle reconciliation through"
```

Expected: FAIL because `reconcileRecordingLifecycleAll()` and `startLifecycleReconciler()` do not exist yet.

- [ ] **Step 3: Update `recordingScheduler.js` to schedule lifecycle reconciliation**

In `backend/services/recordingScheduler.js`, keep the header doc and add the fourth optional task:

```javascript
        tasks.startSegmentScanner?.(scheduleTimeout);
        tasks.startBackgroundCleanup?.(scheduleTimeout);
        tasks.startScheduledCleanup?.(scheduleTimeout);
        tasks.startLifecycleReconciler?.(scheduleTimeout);
```

Update the header `MainFuncs` line so it includes lifecycle reconciliation timer ownership.

- [ ] **Step 4: Integrate reconciler into `recordingService.js`**

In `backend/services/recordingService.js`, add the import near other recording service imports:

```javascript
import { createRecordingLifecycleReconciler } from './recordingLifecycleReconciler.js';
```

Add this constant near other recording timing constants:

```javascript
const RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS = 60 * 1000;
```

Inside `RecordingService.constructor()`, after existing scheduler/recovery initialization, create the reconciler:

```javascript
        this.lifecycleReconciler = createRecordingLifecycleReconciler({
            query,
            queryOne,
            recordingService: this,
            recordingProcessManager,
            logger: console,
        });
```

Change `handleCameraBecameOnline()` signature and cooldown handling:

```javascript
    async handleCameraBecameOnline(cameraId, now = Date.now(), { clearCooldown = true } = {}) {
        if (recordingProcessManager.getStatus(cameraId).status !== 'stopped') {
            return this.getRecordingStatus(cameraId);
        }

        const health = this.ensureRuntimeHealthState(cameraId);
        if (!health.suspendedReason) {
            health.suspendedReason = 'waiting_retry';
        }
        if (clearCooldown) {
            health.cooldownUntil = 0;
        }

        return this.attemptRecordingRecovery(cameraId, health.suspendedReason, now);
    }
```

Add these facade methods to `RecordingService` before `shutdown()`:

```javascript
    async reconcileRecordingLifecycle(cameraId, reason = 'manual', now = Date.now()) {
        return this.lifecycleReconciler.reconcileCamera(cameraId, reason, now);
    }

    async reconcileRecordingLifecycleAll(reason = 'periodic_safety_net', now = Date.now()) {
        return this.lifecycleReconciler.reconcileAll(reason, now);
    }

    startLifecycleReconciler(scheduleTimeout = setTimeout) {
        const reconcileCycle = async () => {
            if (!this.isShuttingDown) {
                await this.reconcileRecordingLifecycleAll('periodic_safety_net');
            }
            scheduleTimeout(reconcileCycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
        };

        scheduleTimeout(reconcileCycle, RECORDING_LIFECYCLE_RECONCILE_INTERVAL_MS);
    }
```

Update `initializeBackgroundWork()` task registration:

```javascript
            startSegmentScanner: (scheduleTimeout) => this.startSegmentScanner(scheduleTimeout),
            startBackgroundCleanup: (scheduleTimeout) => this.startBackgroundCleanup(scheduleTimeout),
            startScheduledCleanup: (scheduleTimeout) => this.startScheduledCleanup(scheduleTimeout),
            startLifecycleReconciler: (scheduleTimeout) => this.startLifecycleReconciler(scheduleTimeout),
```

Update the fallback branch without scheduler:

```javascript
            this.startSegmentScanner();
            this.startBackgroundCleanup();
            this.startScheduledCleanup();
            this.startLifecycleReconciler();
            return;
```

- [ ] **Step 5: Run focused recording tests**

Run:

```bash
cd backend
npm test -- recordingService.test.js recordingLifecyclePolicy.test.js recordingLifecycleReconciler.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/services/recordingService.js backend/services/recordingScheduler.js backend/__tests__/recordingService.test.js
git commit -m "Fix: reconcile stopped online recordings periodically"
```

---

### Task 4: Camera Health Runtime And Transition Wiring

**Files:**
- Modify: `backend/services/cameraHealthService.js`
- Modify: `backend/__tests__/cameraHealthService.test.js`

- [ ] **Step 1: Add failing health tests**

In `backend/__tests__/cameraHealthService.test.js`, extend the hoisted mock values:

```javascript
    reconcileCameraLifecycleMock,
```

and initialize it:

```javascript
    reconcileCameraLifecycleMock: vi.fn(),
```

Update the `recordingService` mock:

```javascript
vi.mock('../services/recordingService.js', () => ({
    recordingService: {
        handleCameraBecameOnline: handleCameraBecameOnlineMock,
        handleCameraBecameOffline: handleCameraBecameOfflineMock,
        reconcileRecordingLifecycle: reconcileCameraLifecycleMock,
    },
}));
```

Add this test near the existing runtime signal tests:

```javascript
    it('triggers recording reconciliation when runtime signal marks a camera online', () => {
        const service = new CameraHealthService();

        service.recordRuntimeSignal(393, {
            targetUrl: 'https://example.test/live.m3u8',
            signalType: 'runtime_success',
            success: true,
            timestamp: Date.now(),
        });

        expect(reconcileCameraLifecycleMock).toHaveBeenCalledWith(393, 'runtime_online_signal');
    });
```

Update the existing status transition test assertion:

```javascript
        expect(reconcileCameraLifecycleMock).toHaveBeenCalledWith(42, 'health_transition_online');
```

Replace the old direct `handleCameraBecameOnline` assertion with:

```javascript
        expect(handleCameraBecameOnlineMock).not.toHaveBeenCalled();
```

The online transition should call the reconciler only; the reconciler then delegates to `handleCameraBecameOnline()`.

- [ ] **Step 2: Run health tests and confirm they fail**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js -t "runtime signal marks|transitions online"
```

Expected: FAIL because health does not call `reconcileRecordingLifecycle()` yet.

- [ ] **Step 3: Wire runtime signal and online transition to reconciler**

In `backend/services/cameraHealthService.js`, add a small helper method inside the `CameraHealthService` class:

```javascript
    triggerRecordingLifecycleReconcile(cameraId, reason) {
        recordingService.reconcileRecordingLifecycle(cameraId, reason).catch((error) => {
            console.error(`[CameraHealth] Failed to reconcile recording for camera ${cameraId}:`, error.message);
        });
    }
```

In `recordRuntimeSignal()`, after the successful `cameraRuntimeStateService.upsertRuntimeState()` call, add:

```javascript
            this.triggerRecordingLifecycleReconcile(cameraId, 'runtime_online_signal');
```

In `handleCameraStatusTransition()`, replace the direct online resume block:

```javascript
                if (camera.enabled && camera.enable_recording) {
                    await recordingService.handleCameraBecameOnline(camera.id);
                }
```

with:

```javascript
                if (camera.enabled && camera.enable_recording) {
                    await recordingService.reconcileRecordingLifecycle(camera.id, 'health_transition_online');
                }
```

Keep offline transition using `handleCameraBecameOffline()` for immediate suspension.

- [ ] **Step 4: Run focused health and recording tests**

Run:

```bash
cd backend
npm test -- cameraHealthService.test.js recordingService.test.js recordingLifecycleReconciler.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/cameraHealthService.js backend/__tests__/cameraHealthService.test.js
git commit -m "Fix: reconcile recording from camera health signals"
```

---

### Task 5: Documentation, Audits, And Full Verification

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Update services module map**

In `backend/services/.module_map.md`, under Recording domain, add:

```markdown
  - `recordingLifecyclePolicy.js`: pure desired-state decision policy for recording process reconciliation.
  - `recordingLifecycleReconciler.js`: DB/process desired-state safety net that starts stopped eligible online recordings and suspends active offline recordings through the `recordingService` facade.
```

In Cross-Service Side Effects, update the health bullet to include:

```markdown
  Runtime online signals and confirmed online transitions trigger recording lifecycle reconciliation so cameras that return after minutes or hours offline resume recording without manual toggles.
```

- [ ] **Step 2: Verify no cleanup/delete code was touched**

Run:

```bash
git diff -- backend/services/recordingCleanupService.js backend/services/recordingFileOperationService.js backend/services/recordingRecoveryService.js backend/services/recordingRecoveryScanner.js backend/services/recordingRetentionPolicy.js
```

Expected: no output.

Run:

```bash
rg -n "deleteFileSafely|quarantineFile|unlink|cleanup|removeFile" backend/services/recordingLifecyclePolicy.js backend/services/recordingLifecycleReconciler.js
```

Expected: no output.

- [ ] **Step 3: Run focused lifecycle gate**

Run:

```bash
cd backend
npm test -- recordingLifecyclePolicy.test.js recordingLifecycleReconciler.test.js recordingService.test.js cameraHealthService.test.js recordingCleanupService.test.js recordingRecoveryService.test.js recordingRecoveryScanner.test.js recordingFileOperationService.test.js
```

Expected: PASS.

- [ ] **Step 4: Run full backend gate**

Run:

```bash
cd backend
npm run migrate
npm test
```

Expected:

- `All migrations completed successfully`
- all backend test files pass
- total test count is higher than the current 469-test baseline because new lifecycle tests were added

- [ ] **Step 5: Run diff hygiene checks**

Run from repo root:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` has no output.
- `git status --short` lists only the intended lifecycle/policy/reconciler/test/map files.

- [ ] **Step 6: Commit final docs/map verification**

```bash
git add backend/services/.module_map.md
git commit -m "Add: document recording lifecycle reconciler"
```

- [ ] **Step 7: Push after all implementation commits**

```bash
git status --short --branch
git push origin main
```

Expected: branch is clean and `main` pushes to GitHub.

---

## Final Acceptance Checklist

- [ ] Offline-for-minutes/hours scenario is covered by tests.
- [ ] Runtime online signal triggers reconciliation.
- [ ] Periodic safety net starts stopped eligible online cameras.
- [ ] Duplicate reconcile calls for one camera are single-flighted.
- [ ] Disabled, recording-disabled, offline, and unrecordable cameras do not start.
- [ ] Offline active recordings still suspend immediately.
- [ ] Cleanup/recovery/delete modules are not modified.
- [ ] Backend migration and full test gate pass.
- [ ] Changes are committed and pushed to `origin/main`.
