<!--
Purpose: Define the approved design for safe recording auto-resume after camera offline/online gaps.
Caller: Agents and maintainers planning backend recording lifecycle work.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, recordingService, cameraHealthService, recordingProcessManager.
MainFuncs: Documents lifecycle invariants, target boundaries, recovery triggers, safety constraints, and verification scope.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Recording Auto-Resume Lifecycle Reconciler Design

## Verification Baseline

This design follows a fresh verification pass on 2026-05-17.

- `npm run migrate` passed in `backend/`.
- `npm test` passed in `backend/`: 66 test files, 469 tests.
- Current storage/recovery/cleanup boundaries are already split:
  - `recordingRecoveryScanner.js` owns non-destructive file scans.
  - `recordingRecoveryService.js` owns bounded finalization/retry/quarantine.
  - `recordingCleanupService.js` and `recordingRetentionPolicy.js` own destructive cleanup decisions.
  - `recordingFileOperationService.js` is the safe delete/quarantine side-effect boundary.
- The remaining high-value gap is recording process lifecycle reconciliation after missed or incomplete offline-to-online transitions.

## Problem

When a CCTV camera goes offline for minutes or hours and later comes back online, recording may not resume if the system misses the exact health transition or loses the in-memory `streamHealthMap` entry that `recordingService.tickHealthMonitoring()` currently depends on.

Current behavior has direct resume hooks:

- `cameraHealthService.handleCameraStatusTransition()` calls `recordingService.handleCameraBecameOnline()` when DB status changes from offline to online.
- `recordingService.handleCameraBecameOnline()` clears cooldown and attempts recovery when the FFmpeg process is stopped.
- `recordingService.tickHealthMonitoring()` retries only for cameras already present in `streamHealthMap`.

The gap is that runtime signals and periodic health reconciliation do not provide a central desired-state check:

`enabled + enable_recording + online + recordable source + FFmpeg stopped => attempt recording start within a bounded delay`

Without that invariant, an online camera can remain stuck with recording stopped until an operator manually toggles recording.

## Design Decision

Add a focused recording lifecycle reconciler instead of rewriting recording storage or cleanup.

This is the safest option because the bug is about process state, not file retention. Cleanup, recovery, and playback should remain unchanged except for map documentation. The new layer will only decide whether recording should be running or suspended, then delegate all process actions to existing `recordingService` facade methods.

## Approaches Considered

### Approach A: Patch `cameraHealthService.recordRuntimeSignal()`

Call `recordingService.handleCameraBecameOnline()` directly when runtime playback proves a camera is online.

Trade-off: small patch, but it adds more recording side effects to an already large health service and still misses startup/state-loss cases.

### Approach B: Expand `recordingService.tickHealthMonitoring()`

Make the existing health tick query all enabled recording cameras instead of only `streamHealthMap`.

Trade-off: fewer files, but it makes `recordingService.js` larger and mixes process watchdog logic with desired-state reconciliation.

### Approach C: Add `recordingLifecyclePolicy.js` and `recordingLifecycleReconciler.js`

Use a pure policy to decide the required action, and a small reconciler to scan desired DB state versus actual FFmpeg state. Wire health transitions, runtime online signals, startup, and a periodic timer into the same reconciler path.

Recommendation: Approach C. It creates one clear owner for the missing invariant, keeps `cameraHealthService.js` and `recordingService.js` thinner, and can be tested without touching file deletion logic.

## Target Architecture

### `backend/services/recordingLifecyclePolicy.js`

Pure decision module. It must not import database, FFmpeg, filesystem, or service singletons.

Public interface:

- `isRecordableCamera(camera)`
- `decideRecordingLifecycleAction({ camera, processStatus, now, cooldownUntil })`

Actions:

- `start`
- `stop_offline`
- `wait_cooldown`
- `noop_recording`
- `noop_disabled`
- `noop_unrecordable`
- `noop_not_online`

Rules:

- Only `enabled=1`, `enable_recording=1`, and recordable delivery/source cameras can start.
- Only online cameras can start.
- A stopped process on an online eligible camera should start unless cooldown is active.
- A non-stopped process on an offline camera should stop/suspend.
- A running process on an online eligible camera is a no-op.

### `backend/services/recordingLifecycleReconciler.js`

Side-effect orchestrator. It reads desired camera state, checks the current process state, applies policy, and delegates actions to `recordingService`.

Public interface:

- `createRecordingLifecycleReconciler(deps)`
- `reconcileCamera(cameraId, reason, now)`
- `reconcileAll(reason, now)`

Required dependencies:

- `query`, `queryOne`
- `recordingService`
- `recordingProcessManager`
- `logger`

Rules:

- Use a per-camera in-flight lock so repeated health/runtime/periodic events cannot double-start FFmpeg.
- Do not call cleanup, file deletion, quarantine, finalizer, or recovery scanner APIs.
- Use `recordingService.handleCameraBecameOnline()` for online start/resume.
- Use `recordingService.handleCameraBecameOffline()` for offline suspension.
- Return structured results for diagnostics and tests.
- Swallow per-camera failures in `reconcileAll()` and continue to the next camera.

### `recordingService.js`

Remains the public facade and owner of start/stop/restart behavior.

Changes should be limited to:

- Expose an idempotent reconciliation entrypoint if needed, or accept calls from the new reconciler.
- Start a periodic lifecycle reconciliation timer from existing startup scheduling.
- Stop that timer during shutdown.

### `cameraHealthService.js`

Should not gain recording start/stop internals.

Allowed changes:

- After an offline-to-online transition, call the reconciler instead of directly embedding resume logic, or route the existing call through a small adapter.
- After `recordRuntimeSignal()` marks a camera online, schedule or trigger `reconcileCamera(cameraId, 'runtime_online_signal')`.

### Maps And Docs

Update `backend/services/.module_map.md` so ownership is explicit:

- `recordingLifecyclePolicy.js`: pure desired-state decisions.
- `recordingLifecycleReconciler.js`: process desired-state safety net.
- Health transitions and runtime signals may trigger reconciliation.

## Lifecycle Triggers

The reconciler must run from four places:

1. Startup: after recording service initialization has loaded enough config to evaluate enabled cameras.
2. Health transition: when health confirms offline-to-online or online-to-offline.
3. Runtime online signal: when stream usage proves a camera is online and updates `cameras.is_online` to `1`.
4. Periodic safety net: every bounded interval, recommended 30-60 seconds.

The periodic path is the main fix for missed events and in-memory state loss.

## Safety Invariants

- No new file deletion or quarantine path is introduced.
- No cleanup policy is modified.
- No finalizer/recovery scanner behavior is modified.
- A camera must not start if disabled, recording disabled, unrecordable, or offline.
- A camera must not start twice; process status and per-camera in-flight lock both guard this.
- Offline suspension must preserve recovery state and use the existing `handleCameraBecameOffline()` behavior.
- Cooldown must prevent tight retry loops, except a confirmed online transition may clear an offline cooldown through the existing `handleCameraBecameOnline()` path.
- Reconciler errors must be logged per camera and must not stop reconciliation for other cameras.

## Testing Strategy

Add focused tests before implementation:

- Policy tests for every action decision.
- Reconciler tests for:
  - stopped eligible online camera starts.
  - active offline camera suspends.
  - disabled or unrecordable cameras do nothing.
  - duplicate concurrent reconciliation for one camera starts only once.
  - `reconcileAll()` continues after one camera fails.
- Camera health test proving `recordRuntimeSignal()` triggers recording reconciliation when runtime evidence marks a camera online.
- Recording service test proving periodic reconciliation catches an online eligible camera that is stopped but absent from `streamHealthMap`.

Full backend verification remains:

- `npm run migrate`
- `npm test`

## Acceptance Criteria

- A camera that is offline for minutes/hours and later becomes online resumes recording without manual toggle.
- Missed health transitions are covered by periodic reconciliation.
- Runtime online signals trigger reconciliation.
- Disabled, recording-disabled, offline, and unrecordable cameras do not start.
- Duplicate event bursts do not create duplicate FFmpeg starts.
- Cleanup/recovery/delete behavior remains untouched and existing cleanup tests still pass.
- Backend full gate passes.
