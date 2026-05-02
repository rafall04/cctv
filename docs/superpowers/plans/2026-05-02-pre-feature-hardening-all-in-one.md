<!--
Purpose: Single execution plan for pre-feature stabilization before adding new CCTV features.
Caller: Maintainers and Codex agents executing the requested stabilization batch.
Deps: SYSTEM_MAP.md, backend/.module_map.md, backend/services/.module_map.md, frontend/src/.module_map.md.
MainFuncs: Migration runner cleanup, recording cleanup observability, health boundary check, HLS proxy boundary check, final gates.
SideEffects: Documentation only.
-->

# Pre Feature Hardening All In One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the highest-value cleanup before feature work: clean migration execution, make recording cleanup decisions auditable, and verify existing health/HLS/frontend extraction boundaries.

**Architecture:** Keep behavior stable and avoid broad rewrites. Fix the concrete migration runner miss, add pure recording cleanup reason helpers, document verified boundaries, and use existing focused tests to prove no regression.

**Tech Stack:** Node.js 20 ES modules, Fastify, better-sqlite3, Vitest, React/Vite existing tests.

---

## File Structure

- Modify `backend/database/run-all-migrations.js`: add Header Doc, ensure `backend/data` exists, exclude nested aggregate migration scripts from direct scanning, and export pure selection helpers.
- Create `backend/__tests__/migrationRunner.test.js`: verify migration file filtering excludes runner scripts and preserves normal migration order.
- Modify `backend/services/recordingRetentionPolicy.js`: add a pure `describeRecordingRetentionDecision` helper for consistent cleanup log reasons.
- Modify `backend/__tests__/recordingRetentionPolicy.test.js`: verify recent and expired decision descriptions.
- Modify `backend/services/recordingCleanupService.js`: use the decision helper in retention skip paths without changing delete behavior.
- Modify `backend/services/.module_map.md`: document verified frontend helper extraction and remaining large-file boundaries.
- Run backend gates and focused frontend utility tests.

---

## Task 1: Migration Runner Hygiene

- [ ] Write failing tests in `backend/__tests__/migrationRunner.test.js` for `selectRunnableMigrationFiles`.
- [ ] Run `npm test -- migrationRunner.test.js` and confirm RED.
- [ ] Add exported helpers to `backend/database/run-all-migrations.js`.
- [ ] Ensure the runner creates `backend/data` before migrations open SQLite.
- [ ] Run `npm test -- migrationRunner.test.js` and confirm GREEN.
- [ ] Commit: `Fix: harden migration runner selection`.

## Task 2: Recording Cleanup Decision Trace

- [ ] Add tests to `backend/__tests__/recordingRetentionPolicy.test.js` for `describeRecordingRetentionDecision`.
- [ ] Run the retention test and confirm RED.
- [ ] Implement the helper in `backend/services/recordingRetentionPolicy.js`.
- [ ] Wire `backend/services/recordingCleanupService.js` skip logging through the helper.
- [ ] Run recording cleanup/retention tests and confirm GREEN.
- [ ] Commit: `Fix: trace recording retention cleanup decisions`.

## Task 3: Boundary Documentation

- [ ] Update `backend/services/.module_map.md` with the verified migration/recording cleanup invariant and note existing frontend utility extraction.
- [ ] Confirm no runtime code changed in frontend helpers because `mapCoordinateUtils` and `playbackSegmentSelection` already exist with tests.
- [ ] Commit: `Add: document pre feature stabilization boundaries`.

## Task 4: Verification And Main Integration

- [ ] Run `npm run migrate` in `backend`.
- [ ] Run `npm test` in `backend`.
- [ ] Run `npm test -- src/utils/mapCoordinateUtils.test.js src/utils/playbackSegmentSelection.test.js` in `frontend`.
- [ ] Push branch.
- [ ] Merge to `main`.
- [ ] Push `main`.

---

## Self-Review

- Scope is one stabilization batch and avoids large risky rewrites.
- No placeholder sections remain.
- TDD is required for the production code changes.
