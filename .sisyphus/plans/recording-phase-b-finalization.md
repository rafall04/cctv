# Work Plan: Recording Phase B - Finalization-Safe Ingest (Fix Persistent moov Atom Errors)

## Objective
Eliminate persistent `moov atom not found` errors in production by replacing heuristic file-finalization detection with deterministic segment-finalization signals, while preserving current cleanup and retention behavior.

## Problem Statement (Verified)
1. File watcher declares files "Finalized" using only size-stability checks (3s windows).
2. MP4 `moov` metadata can still be incomplete when ffprobe runs.
3. SegmentProcessor retries reduce noise but still fails for files that are not truly finalized.
4. Result: false invalidation/deletion and repeated ffprobe failures in PM2 logs.

## Root Cause Summary
- Current trigger source (`fs.watch` + size stability) is not a reliable completion signal for MP4 segment writes under unstable RTSP conditions.
- We need a writer-truth signal from FFmpeg, not filesystem heuristics.

## Design Decision
Use FFmpeg segment manifest (`-segment_list`) as the primary ingestion trigger.
- `fileWatcher` becomes fallback for orphan recovery only.
- SegmentProcessor consumes only entries explicitly emitted as completed by FFmpeg.

## Execution Waves

- [x] **Wave B1: FFmpeg Manifest Emission**
  - Update `streamEngine` ffmpeg args per camera to emit segment list file:
    - `-segment_list <cameraDir>/segments.csv`
    - `-segment_list_type csv`
    - keep existing wall-clock segmentation flags (`segment_time=600`, `segment_atclocktime=1`).
  - Ensure each camera has independent manifest file.
  - **Acceptance**: Manifest file appears and receives one row per completed segment.

- [x] **Wave B2: Manifest Consumer Service**
  - Add `segmentListWatcher.js` (new service) to tail/parse `segments.csv` safely:
    - keep read offset per camera
    - parse newly appended lines only
    - enqueue file path to SegmentProcessor
    - dedupe by `(cameraId, filename)` before enqueue
  - **Acceptance**: New segment queue events come from manifest entries, not raw `fs.watch` writes.

- [x] **Wave B3: Demote FileWatcher to Fallback**
  - Keep existing `fileWatcher` but disable as primary ingest trigger.
  - Use only for periodic orphan detection/recovery paths.
  - Reduce noisy stabilization logs to debug-level summary.
  - **Acceptance**: Primary ingest path no longer uses `[FileWatcher] Finalized` events.

- [x] **Wave B4: SegmentProcessor Probe Policy Tightening**
  - Keep retry loop but classify probe failures:
    - if `moov atom not found` on first probes, retry with backoff (already exists)
    - after max retries: mark as deferred (not immediate delete), requeue once after cool-down
  - Delete only when duration invalid after deferred retry window.
  - **Acceptance**: Significant drop in immediate deletion of potentially valid segments.

- [x] **Wave B5: Log & Metrics Hardening**
  - Add counters:
    - `manifest_ingest_count`
    - `manifest_parse_errors`
    - `probe_retry_count`
    - `probe_deferred_count`
    - `probe_final_fail_count`
  - Keep per-camera summary every N segments (not per-line spam).
  - **Acceptance**: PM2 logs explain pipeline state without noise floods.

## Validation Matrix (Mandatory)
1. **Cold boot with unstable camera links**
   - Expect no burst of `moov atom not found` right after startup.
2. **Disconnect at minute 2, reconnect before minute 10 boundary**
   - Segment continuity preserved; no false invalidation due to early probe.
3. **Flapping test (5-20s toggles for 10 mins)**
   - Queue remains stable, no duplicate DB inserts.
4. **Retention + cleanup unaffected**
   - Existing per-camera cutoff delete behavior remains deterministic.
5. **Playlist still playable**
   - Existing discontinuity behavior remains intact.

## Rollout Plan
- Canary 2 cameras for 24h.
- Expand to 50% cameras for 24h if:
  - `probe_final_fail_count` reduced by >=80%
  - no cleanup regressions
  - no duplicate DB rows
- Full rollout after canary pass.

## Rollback Plan
- Feature flag: `RECORDING_INGEST_SOURCE=watcher|manifest`
- If regressions appear, switch to `watcher` and restart service.

## Success Criteria
- `moov atom not found` becomes rare/exception-only.
- No repeated ffprobe failures for fresh segments under normal operation.
- Segment ingestion is deterministic and maintainable.
