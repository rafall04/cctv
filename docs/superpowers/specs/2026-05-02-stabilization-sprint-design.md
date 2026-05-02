# Stabilization Sprint Design

## Purpose

Prepare the CCTV project for a larger wave of new features by reducing current maintenance risk first. The sprint focuses on quality gates, repository hygiene, and splitting the highest-risk modules without changing public behavior.

## Current Evidence

- Backend verification is healthy: `npm run migrate` passed with 40 successful migrations and 0 failures; `npm test` passed 29 files and 211 tests.
- Frontend tests are healthy: `npm test` passed 47 files and 208 tests.
- Frontend production build is healthy: `npm run build` passed.
- Frontend lint is not healthy: `npm run lint` reports one error in `LandingCameraCard.jsx` and one hook warning in `ViewerAnalytics.jsx`.
- Several modules are large enough to slow future feature work and increase regression risk:
    - `frontend/src/components/MapView.jsx`
    - `frontend/src/pages/Playback.jsx`
    - `frontend/src/pages/AreaManagement.jsx`
    - `backend/services/cameraHealthService.js`
    - `backend/services/cameraService.js`
    - `backend/routes/hlsProxyRoutes.js`
- The repository root contains large temporary/export artifacts that can confuse future work and increase accidental commit risk.

## Goals

1. Restore quality gates so lint, tests, build, and migrations can be trusted before feature work.
2. Reduce accidental commit risk from temporary artifacts and large root files.
3. Split the most active large frontend modules along existing behavior boundaries.
4. Split backend camera health and stream orchestration into smaller units with explicit interfaces.
5. Preserve existing behavior unless a test demonstrates a bug.

## Non-Goals

- No new user-facing feature.
- No visual redesign.
- No database schema redesign beyond hygiene required by existing migrations.
- No broad dependency upgrades.
- No deletion of user data or private exports without explicit approval.

## Approach

### Phase 1: Quality Gate Cleanup

Fix the current frontend lint failures:

- Remove or use the unused `availabilityState` assignment in `LandingCameraCard.jsx`.
- Stabilize `ViewerAnalytics.jsx` hook dependencies by memoizing the `activeSessions` default or moving the default outside render.

After the fix, verify:

- `cd frontend && npm run lint`
- `cd frontend && npm test`
- `cd frontend && npm run build`
- `cd backend && npm test`

### Phase 2: Repository Hygiene Guard

Audit root-level artifacts and classify them as one of:

- required project asset
- private export/import data
- debug temporary file
- obsolete artifact

For tracked files, do not remove or move them without a clear classification. Add or update ignore rules so future generated files such as `tmp_*`, decrypted dumps, and local APK/import artifacts do not get accidentally committed.

Expected output:

- `.gitignore` rules for local artifact classes.
- A short note in the final report listing files that need human approval before deletion or archival, if any.

### Phase 3: Frontend Boundary Split

Split frontend modules incrementally, starting with low-risk extractions:

- `MapView.jsx`: extract pure area/camera filtering helpers, popup state helpers, and presentational controls before touching map behavior.
- `Playback.jsx`: extract URL parameter parsing, segment selection logic, and playback session tracking hooks.
- `AreaManagement.jsx`: extract area card/table/filter subcomponents and payload adapters.

The existing tests remain the main regression net. Add focused unit tests only when extracting logic that is not already covered.

### Phase 4: Backend Boundary Split

Split backend modules around clear responsibilities:

- `cameraHealthService.js`: extract health policy resolution, passive evidence evaluation, weighted failure scoring, and probe target selection.
- `cameraService.js`: extract read models, write payload normalization, and bulk operation helpers.
- `hlsProxyRoutes.js`: extract request validation, stream source resolution, proxy response handling, and error mapping.

The public API response shape must stay compatible with current frontend usage. Database access should stay parameterized and avoid widening query scope.

## Risk Controls

- Work in small commits.
- Keep behavior-preserving refactors separate from bug fixes.
- Run focused tests after each split, then full verification at the end.
- Do not delete user or project artifacts unless classification is clear and approved.
- Keep `.module_map.md` or map docs in sync if created during the sprint.

## Completion Criteria

- Frontend lint passes.
- Frontend tests pass.
- Frontend build passes.
- Backend tests pass.
- Backend migrations pass.
- Root artifact risk is reduced through ignore rules and/or documented classification.
- At least one high-risk frontend module and one high-risk backend module have clearer boundaries or extracted helpers without behavior regression.

## Recommended Implementation Order

1. Fix frontend lint and verify baseline.
2. Add repository hygiene guard.
3. Split `MapView.jsx` or `Playback.jsx` first, depending on the next feature direction.
4. Split `cameraHealthService.js` policy/resolver boundaries.
5. Run full verification and push the completed stabilization branch.
