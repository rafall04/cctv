# Recording Lifecycle Hardening Design

Purpose: Define the approved best-practice refactor for CCTV recording process safety.
Caller: Human/operator review before implementation planning.
Deps: `backend/services/recordingService.js`, `backend/server.js`, FFmpeg segment muxing, PM2/process signals.
MainFuncs: Specify lifecycle boundaries, shutdown semantics, restart locking, failure classification, and verification scope.
SideEffects: Documentation only; no runtime behavior changes.

## Problem

FFmpeg recording can be stopped while the segment muxer is finalizing an MP4 trailer. Production logs show `Immediate exit requested`, `received signal 2`, and `Failure occurred when ending segment`, then the app records the event as `ffmpeg_failed`.

This is a lifecycle/control-plane problem, not primarily a camera codec problem. Recording storage is critical, so the fix must prevent intentional stop, deploy restart, PM2 restart, camera offline handling, and health-restart flows from corrupting the active segment or misclassifying controlled exits as crashes.

## Design Decision

Use a phased refactor centered on a dedicated Recording Process Manager. This is more work than a patch, but it creates a stable boundary for FFmpeg process ownership and reduces future data-loss risk.

The existing `recordingService.js` remains the facade for current routes and callers during the first phase. New modules take over single-purpose responsibilities behind that facade.

## Target Architecture

### `recordingProcessManager.js`

Owns FFmpeg child processes and process lifecycle only.

Public interface:

- `start(cameraId, config)`
- `stop(cameraId, reason, options)`
- `restart(cameraId, reason, config)`
- `shutdownAll(reason)`
- `getStatus(cameraId)`
- `getActiveCameraIds()`

Rules:

- Stop is awaitable.
- Restart is serialized per camera.
- Shutdown waits for active stops before returning.
- Fallback `SIGKILL` is allowed only after a configured timeout.
- Process manager records stop intent before sending a signal.

### `recordingFailureClassifier.js`

Classifies FFmpeg exits using output, exit code, signal, and internal stop reason.

Required classes:

- `intentional_stop`
- `intentional_shutdown`
- `restart_requested`
- `upstream_unreachable`
- `unsupported_playlist`
- `invalid_source`
- `ffmpeg_failed`

`Immediate exit requested`, `received signal`, or a known internal stop reason must not be logged as a crash.

### `recordingRuntimeState.js`

Stores runtime-only state per camera.

State fields:

- `cameraId`
- `pid`
- `status`
- `startedAt`
- `lastDataAt`
- `stopReason`
- `stopStartedAt`
- `restartInFlight`
- `shutdownInFlight`
- `forcedKill`
- `lastExitCode`
- `lastExitSignal`

This avoids scattered Map mutation across health monitoring, stop, restart, and process close handlers.

### `recordingService.js`

Remains the facade for existing callers.

Responsibilities retained:

- Camera DB lookup.
- DB recording status updates.
- Health transition coordination.
- Segment creation integration.
- Calling process manager for start, stop, restart, and shutdown.

It must not own raw FFmpeg signal handling after the refactor.

### `server.js`

Becomes the single shutdown orchestrator.

Rules:

- Only `server.js` registers process-level shutdown handlers.
- Shutdown order stops background services first, then calls `await recordingService.shutdown()`, then closes DB connections and HTTP server.
- No service module may call `process.exit()` from its own signal handler.

## Lifecycle Semantics

### Start

Start validates camera configuration, resolves stream source, creates output directory, builds FFmpeg args, and delegates spawn to the process manager. The facade updates camera status only after spawn succeeds.

### Stop

Stop records intent, sends a graceful signal, waits for `close`, and only then removes active runtime state. If timeout expires, it sends `SIGKILL`, marks `forcedKill=true`, waits for close, and logs the forced stop.

### Restart

Restart acquires a per-camera lock, stops the current process fully, waits for close, then starts a new process. No new FFmpeg process may start while the old one is still closing.

### Shutdown

Shutdown disables recovery/restart loops, stops scanners/intervals, then drains all active FFmpeg processes through `shutdownAll('server_shutdown')`.

Intentional shutdown exits must not call `markRecordingFailure()` or `logRestart(..., false)` as a crash.

## Error Handling

FFmpeg `close` handling uses both process facts and intent:

- Known stop intent + non-zero code = controlled exit.
- Unknown stop intent + non-zero code = failure classification.
- Signal output during shutdown = controlled shutdown.
- Forced kill after timeout = controlled but degraded stop; log as warning, not camera crash.

DB status should reflect operator-facing state:

- Manual stop: `stopped`
- Shutdown: leave durable recording enablement unchanged; runtime process stops because app exits.
- Camera offline: `suspended_offline`
- Unknown FFmpeg crash: failure cooldown/recovery path.

## Observability

Each lifecycle transition logs one structured line with:

- `cameraId`
- `pid`
- `action`
- `reason`
- `signal`
- `exitCode`
- `exitSignal`
- `durationMs`
- `forcedKill`

This is enough to distinguish deploy restarts from camera/source failures.

## Testing Strategy

Use Vitest tests around mocked child processes.

Required coverage:

- Intentional stop with FFmpeg exit code `255` is not classified as `ffmpeg_failed`.
- Shutdown calls stop for every active recording and awaits `close`.
- Stop timeout sends `SIGKILL` only after graceful timeout.
- Restart waits for old process close before spawning the new process.
- Health monitor restart does not run when shutdown is in progress.
- Server shutdown invokes `recordingService.shutdown()` before DB close.

## Phasing

### Phase 1: Safety Boundary

Extract classifier and process manager with tests. Keep facade API stable. Move signal handling out of `recordingService.js`.

### Phase 2: Runtime State Cleanup

Extract runtime state and restart locks. Replace scattered Map mutation with explicit lifecycle state transitions.

### Phase 3: Segment/Remux Follow-Up

After lifecycle is safe, evaluate segment/remux scanner separation. This is intentionally not part of the first implementation because the immediate data-loss risk is process shutdown timing.

## Non-Goals

- Do not change recording file format in this phase.
- Do not change public playback APIs.
- Do not rewrite camera health service.
- Do not tune retention or storage cleanup policies.
- Do not introduce a new queue or database schema unless tests prove runtime memory state is insufficient.

## Acceptance Criteria

- Controlled shutdown/restart no longer appears as `ffmpeg_failed`.
- No process-level signal handlers remain in recording service modules.
- All FFmpeg stops are awaitable and timeout-bounded.
- Restart cannot overlap old and new FFmpeg processes for the same camera.
- Backend recording tests pass.
- Shutdown order is explicit and documented in code.
