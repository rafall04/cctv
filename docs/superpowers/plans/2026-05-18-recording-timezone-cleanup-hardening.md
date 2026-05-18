<!--
Purpose: Implementation plan for recording timezone normalization and urgent cleanup hardening.
Caller: Agents executing the May 18 recording cleanup incident remediation.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md.
MainFuncs: Defines TDD tasks, target files, verification, commit flow.
SideEffects: Documentation only.
-->

# Recording Timezone Cleanup Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix recording cleanup retention decisions so FFmpeg filename timestamps, DB segment timestamps, and emergency cleanup all use one explicit timezone contract.

**Architecture:** Keep `recordingService.js` as the compatibility facade and move timestamp/process-time decisions into focused policy helpers. Normal retention remains conservative, while disk emergency cleanup can bypass retention only for safe registered segment files when service availability is at risk.

**Tech Stack:** Node.js 20 ES modules, Fastify service layer, better-sqlite3 migrations, Vitest.

---

## File Structure

- Modify `backend/services/recordingTimePolicy.js`: parse recording filenames as configured app timezone and expose timezone helpers.
- Create `backend/services/recordingProcessTimePolicy.js`: build FFmpeg child-process environment with an explicit `TZ`.
- Modify `backend/services/recordingSegmentFilePolicy.js`: pass timezone-aware filename parsing through segment parsing.
- Modify `backend/services/recordingProcessManager.js`: accept spawn options without changing current callers.
- Modify `backend/services/recordingService.js`: pass explicit FFmpeg timezone env and enable retention bypass only in emergency disk cleanup.
- Modify `backend/services/recordingCleanupService.js`: support audited emergency retention bypass for DB-registered files.
- Create `backend/database/migrations/zz_20260518_repair_recording_segment_timezone.js`: repair shifted existing `recording_segments` rows only when filename-local time is closer to file mtime or the existing row is clearly in the future.
- Modify `backend/services/.module_map.md`: document the recording timezone invariant and emergency cleanup exception.
- Modify tests in `backend/__tests__/`: add failing coverage before production edits.

## Tasks

### Task 1: Timezone Regression Tests

**Files:**
- Modify: `backend/__tests__/recordingRetentionPolicy.test.js`
- Modify: `backend/__tests__/recordingSegmentFilePolicy.test.js`

- [ ] **Step 1: Add failing tests**

Add tests proving `20260518_170000.mp4` in `Asia/Jakarta` resolves to `2026-05-18T10:00:00.000Z`, and retention can delete it after one hour plus grace.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js`

Expected: FAIL because filename parsing currently treats the timestamp as UTC.

- [ ] **Step 3: Implement minimal timezone parser**

Update `recordingTimePolicy.js` to convert filename local date parts through `Intl.DateTimeFormat(..., { timeZone })`, defaulting to the configured timezone.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js`

Expected: PASS.

### Task 2: FFmpeg Process Timezone Standard

**Files:**
- Create: `backend/services/recordingProcessTimePolicy.js`
- Modify: `backend/services/recordingProcessManager.js`
- Modify: `backend/services/recordingService.js`
- Test: `backend/__tests__/recordingProcessManager.test.js`
- Test: `backend/__tests__/recordingProcessTimePolicy.test.js`

- [ ] **Step 1: Add failing tests**

Assert the process-time policy sets `TZ` to the configured recording timezone and `RecordingProcessManager.start()` forwards spawn options to `spawn`.

- [ ] **Step 2: Run tests to verify failure**

Run: `npm test -- recordingProcessManager.test.js recordingProcessTimePolicy.test.js`

Expected: FAIL because spawn options and the new policy do not exist yet.

- [ ] **Step 3: Implement minimal process-time policy**

Create a small helper that returns `{ ...baseEnv, TZ: timezone }`; wire `recordingService.startRecording()` to pass it into `recordingProcessManager.start()`.

- [ ] **Step 4: Run tests to verify pass**

Run: `npm test -- recordingProcessManager.test.js recordingProcessTimePolicy.test.js`

Expected: PASS.

### Task 3: Emergency Cleanup That Actually Frees Space

**Files:**
- Modify: `backend/services/recordingCleanupService.js`
- Modify: `backend/services/recordingService.js`
- Test: `backend/__tests__/recordingCleanupService.test.js`

- [ ] **Step 1: Add failing emergency test**

Add a test where free disk is below target, the oldest registered segment is still inside retention, and `allowRetentionBypass: true` deletes it through `safeDelete`.

- [ ] **Step 2: Run test to verify failure**

Run: `npm test -- recordingCleanupService.test.js`

Expected: FAIL because current emergency cleanup skips not-expired files.

- [ ] **Step 3: Implement minimal bypass**

In `emergencyCleanup()`, keep unsafe filenames blocked, but allow DB-registered segment deletion before retention only when `allowRetentionBypass` is true. Use reason `emergency_disk_cleanup_retention_bypass`.

- [ ] **Step 4: Wire emergency mode**

Pass `allowRetentionBypass: true` from `recordingService.emergencyDiskSpaceCheck()`.

- [ ] **Step 5: Run test to verify pass**

Run: `npm test -- recordingCleanupService.test.js`

Expected: PASS.

### Task 4: Existing Data Repair Migration

**Files:**
- Create: `backend/database/migrations/zz_20260518_repair_recording_segment_timezone.js`

- [ ] **Step 1: Add migration script**

Repair rows only when the filename parsed in configured timezone is closer to actual file mtime than the existing DB timestamp, or when the existing DB timestamp is more than one hour in the future and the repaired timestamp is not.

- [ ] **Step 2: Run migration**

Run: `npm run migrate`

Expected: migration completes and logs how many rows were repaired.

### Task 5: Verification And Documentation

**Files:**
- Modify: `backend/services/.module_map.md`

- [ ] **Step 1: Sync module map**

Document that recording filename timestamps are app-timezone local labels converted to UTC ISO in DB, and emergency DB-segment cleanup can bypass retention under low disk pressure.

- [ ] **Step 2: Run focused recording verification**

Run: `npm test -- recordingRetentionPolicy.test.js recordingSegmentFilePolicy.test.js recordingProcessTimePolicy.test.js recordingProcessManager.test.js recordingCleanupService.test.js recordingService.test.js recordingSegmentRepository.test.js recordingPlaybackService.test.js`

Expected: PASS.

- [ ] **Step 3: Run full backend gate**

Run: `npm run migrate && npm test`

Expected: PASS.

- [ ] **Step 4: Commit and push**

Run:

```bash
git status
git add backend/services/recordingTimePolicy.js backend/services/recordingProcessTimePolicy.js backend/services/recordingSegmentFilePolicy.js backend/services/recordingProcessManager.js backend/services/recordingService.js backend/services/recordingCleanupService.js backend/database/migrations/zz_20260518_repair_recording_segment_timezone.js backend/services/.module_map.md backend/__tests__/recordingRetentionPolicy.test.js backend/__tests__/recordingSegmentFilePolicy.test.js backend/__tests__/recordingProcessTimePolicy.test.js backend/__tests__/recordingProcessManager.test.js backend/__tests__/recordingCleanupService.test.js docs/superpowers/plans/2026-05-18-recording-timezone-cleanup-hardening.md
git commit -m "Fix: harden recording timezone cleanup"
git push
```
