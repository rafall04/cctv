<!--
Purpose: Define the approved design for refactoring old recording segment cleanup.
Caller: Superpowers brainstorming review before implementation planning.
Deps: backend/services/recordingService.js, backend/services/recordingPlaybackService.js, SQLite recording_segments schema.
MainFuncs: Recording retention policy, cleanup repository queries, cleanup service orchestration, playback segment query boundary.
SideEffects: Documentation only; no runtime behavior changes.
-->

# Recording Cleanup Refactor Design

Date: 2026-05-02
Scope: Backend recording segment cleanup and the playback segment query boundary that depends on retained segments.

## Problem

Old segment cleanup currently works, and the focused `recordingService.test.js` suite passes, but the logic is too spread out to safely add larger playback and retention features.

The current cleanup behavior is split across scheduled cleanup, background orphan cleanup, temp cleanup, and emergency disk cleanup inside `backend/services/recordingService.js`. The most important risks are full-table/per-camera scans, overlapping cleanup runs, duplicated age/path rules, silent orphan cleanup failures, and playback APIs that load all segments before slicing in memory.

## Goals

1. Keep existing retention behavior: delete only expired segments, protect recent files, reject unsafe paths, and quarantine corrupt files.
2. Move cleanup rules into small units with clear responsibilities.
3. Make cleanup scalable for many cameras and many retained segments.
4. Make failures observable without noisy per-file logs.
5. Prepare playback for future features that need time windows, pagination, and reliable latest/oldest selection.

## Non-Goals

1. No frontend playback redesign.
2. No change to public/admin playback access policy except correcting query boundaries.
3. No database engine change.
4. No aggressive deletion policy change beyond current emergency disk behavior.

## Recommended Architecture

Use a staged extraction, not a rewrite.

### `recordingRetentionPolicy.js`

Purpose: pure retention and path decisions.

Responsibilities:
1. Calculate retention cutoff from `recording_duration_hours` plus grace.
2. Parse segment filenames with one deterministic timestamp helper.
3. Validate final, remux, and temp recording filenames with explicit regexes.
4. Decide whether a DB segment or filesystem orphan is eligible for cleanup.

This module should not touch SQLite or the filesystem.

### `recordingSegmentRepository.js`

Purpose: focused SQLite access for recording segment cleanup and playback.

Responsibilities:
1. Fetch expired DB-tracked segments with `WHERE camera_id = ? AND start_time < ? ORDER BY start_time ASC LIMIT ?`.
2. Fetch missing-file cleanup candidates in bounded batches.
3. Delete segment rows by id.
4. Fetch playback segments by scope, time window, order, and limit.

DB note: existing index `(camera_id, start_time)` supports the cutoff query. If playback adds lookup by filename per camera, add or verify an index on `(camera_id, filename)`.

### `recordingCleanupService.js`

Purpose: orchestrate cleanup without owning recording process lifecycle.

Responsibilities:
1. Run per-camera cleanup with an in-flight lock.
2. Delete expired DB-tracked files in bounded batches.
3. Delete filesystem orphans only through the shared retention policy and safe-delete helper.
4. Return structured counters: deleted, missingRowsDeleted, quarantined, unsafeSkipped, processingSkipped, failed.
5. Provide one public method for scheduled cleanup and one public method for emergency cleanup.

This service should receive dependencies explicitly enough to test with mocks: repository, filesystem adapter, logger, and safe file delete/quarantine helpers.

### `recordingService.js`

Purpose after refactor: recording lifecycle facade.

Responsibilities kept here:
1. Start, stop, restart, and shutdown FFmpeg recording processes.
2. Track files being processed during remux.
3. Call the cleanup service from scheduled timers.
4. Preserve public methods currently used by routes and health services.

Cleanup internals should move out, but the current public `cleanupOldSegments(cameraId)` entry point can remain as a compatibility wrapper during migration.

## Data Flow

Scheduled cleanup:
1. `recordingService` timer gathers enabled camera ids plus camera dirs.
2. For each camera, `recordingCleanupService.cleanupCamera(cameraId)` checks the in-flight lock.
3. Repository fetches the camera retention config and expired DB segment batch using cutoff SQL.
4. Cleanup service skips files in `filesBeingProcessed`, safe-deletes eligible files, then deletes DB rows.
5. Filesystem orphan scan compares directory files to DB filenames and applies the same retention policy.
6. A single summary log is emitted per camera.

Playback segment listing:
1. `recordingPlaybackService` asks repository for segments using explicit order, limit, and optional time range.
2. Admin can request a bounded full playback window.
3. Public preview uses a clearly defined policy: latest available preview window unless product requirements say oldest preview.
4. Stream-by-filename uses a `(camera_id, filename)` lookup within the resolved access scope instead of loading all segments and searching in memory.

## Error Handling

1. Unsafe paths are skipped and counted, never deleted from DB.
2. Missing files older than the missing-file grace window can have DB rows removed.
3. Corrupt files are quarantined, not immediately deleted.
4. Files being remuxed are skipped and retried on a later cycle.
5. Per-file errors are counted; logs should include camera id, reason, and aggregate counts.
6. Emergency cleanup can bypass normal retention only when free disk is below threshold, matching current behavior, but it still must use safe path validation.

## Testing

Add focused backend tests before implementation changes:
1. Retention policy computes cutoff and grace correctly.
2. Filename age parsing is deterministic.
3. Safe filename validation rejects partial temp-name matches.
4. Cleanup uses bounded cutoff SQL instead of full segment scans.
5. In-flight lock prevents overlapping cleanup for one camera.
6. Unsafe DB paths are skipped without DB deletion.
7. Recent DB and filesystem orphan segments are retained.
8. Emergency cleanup continues past skipped/missing entries.
9. Playback public preview returns the intended latest preview window.
10. Stream-by-filename does not load all camera segments.

Run at minimum:

```bash
cd backend
npm test -- recordingService.test.js
npm test -- recordingPlaybackService.test.js
```

## Implementation Order

1. Add policy and repository skeletons with header docs and tests for pure behavior.
2. Move safe filename and age logic into policy without changing callers.
3. Add repository methods and update cleanup tests to assert bounded SQL shape.
4. Extract cleanup orchestration behind the existing `cleanupOldSegments(cameraId)` wrapper.
5. Refactor emergency cleanup to use the same safe delete and progress rules.
6. Update playback segment queries to use repository limits, ordering, and filename lookup.
7. Run focused tests, then full backend tests if the focused suite is stable.

## Acceptance Criteria

1. Existing cleanup tests still pass.
2. New cleanup tests cover the identified retention, lock, path, and query-boundary risks.
3. Normal cleanup does not query all segments for a camera when only expired candidates are needed.
4. Cleanup cannot overlap for the same camera.
5. Public/admin playback behavior remains compatible, with preview window selection made explicit.
6. `recordingService.js` is smaller and no longer owns detailed retention/orphan cleanup rules.
