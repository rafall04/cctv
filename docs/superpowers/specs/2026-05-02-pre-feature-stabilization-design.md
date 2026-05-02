<!--
Purpose: Design the pre-feature stabilization track for RAF NET Secure CCTV Hub.
Caller: Maintainers before adding larger backend, frontend, streaming, or playback features.
Deps: SYSTEM_MAP.md, frontend/backend module maps, current verification output, existing stabilization specs.
MainFuncs: Defines stabilization priorities, sequencing, boundaries, risk controls, and verification gates.
SideEffects: None; documentation only.
-->

# Pre-Feature Stabilization Design

## Purpose

Stabilize the project before adding new features. The current baseline is functional, but several hot-path modules are large enough that new feature work will increase regression risk unless the boundaries are improved first.

## Current Baseline

- Backend `npm test`: 30 test files, 216 tests passing.
- Frontend `npm test`: 49 test files, 216 tests passing.
- Frontend `npm run lint`: passing.
- Frontend `npm run build`: passing.
- Current risk is maintainability and UI interaction debt, not a broken baseline.

## Goals

1. Keep public/admin behavior unchanged while reducing large-file risk.
2. Fix the admin login bounce when the app is accessed through a server IP before doing larger refactors.
3. Split high-change modules into focused helpers, hooks, and services.
4. Clean up test noise so future failures are easier to see.
5. Preserve playback/live tracking separation.
6. Keep database-heavy changes indexed, batched, and covered by focused tests.

## Non-Goals

- No broad visual redesign.
- No new feature scope.
- No dependency upgrade campaign.
- No schema redesign unless a later feature explicitly requires it.
- No deletion or archival of operational artifacts without approval.

## Recommended Approach

### 0. Admin Auth IP Access Stabilization

Treat direct-IP admin access as a production-supported entry point. The observed failure mode is: login returns success, the frontend stores the user, then the first protected admin API request fails and the global session-expired handler sends the user back to `/admin/login`.

Root-cause investigation should start at the session boundary, not the page:

- verify whether `/api/auth/login` sets `token` and `refreshToken` cookies for `http://SERVER_IP`, `http://SERVER_IP:PORT_PUBLIC`, and HTTPS proxy access
- verify whether `/api/admin/stats` receives the `token` cookie immediately after login
- verify whether runtime config keeps admin API calls same-origin when the UI is opened by IP
- verify whether generated Nginx/Apache proxy configs preserve `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`
- add tests around cookie option derivation and frontend session-expired behavior before changing auth code

The expected fix should keep HttpOnly cookie auth as the primary path. Avoid localStorage JWT fallback unless evidence shows no same-origin deployment path can be made reliable.

### 1. Backend Health Boundary

Split `backend/services/cameraHealthService.js` around responsibilities:

- probe clients and request options
- passive runtime evidence evaluation
- weighted failure scoring
- cadence/domain backoff decisions
- transition side effects for notifications, recording, thumbnails, and MediaMTX repair
- health debug data shaping

Keep the existing service API stable. Extract pure helpers first, then wire side effects behind focused functions.

### 2. Backend Camera Service Boundary

Split `backend/services/cameraService.js` into smaller ownership areas:

- camera read models and public/admin projections
- create/update payload normalization
- import planning/application
- restore preview/application
- bulk area policy planning/application

Keep cache invalidation, audit logging, runtime updates, and MediaMTX sync explicit at mutation boundaries.

### 3. Frontend Live Map Boundary

Split `frontend/src/components/MapView.jsx` and live popup behavior:

- marker icon and grouping helpers
- area summary and viewport command helpers
- map top/status chrome components
- stream modal state machine hooks shared with `VideoPopup`
- viewer session and runtime signal handling hooks

The map layer controls must remain clickable at low zoom when aggregate hints are visible.

### 4. Frontend Playback Boundary

Split `frontend/src/pages/Playback.jsx` into focused hooks:

- `usePlaybackSelection` for `cam`/`t`, camera list, segment choice, and stale segment guards
- `usePlaybackMediaSource` for stream URL, source tokens, buffering, and autoplay
- `usePlaybackViewerTracking` for session start/stop after real playback begins
- `usePlaybackShareSnapshot` for share URL and snapshot behavior

Public playback stays `public_preview`; admin playback stays `admin_full`.

### 5. Frontend Area Admin Boundary

Split `frontend/src/pages/AreaManagement.jsx` into:

- area list/card presentation
- area form modal state
- map center modal state
- bulk policy preview/apply hook
- pure bulk payload helpers

Bulk DB writes should remain backend-side and should avoid N+1 query loops.

### 6. Test Noise Cleanup

Reduce known noisy output:

- `useLandingReachability` tests should mock health responses without logging incidental `undefined.reachable` errors.
- lazy/suspense tests should await loaded content to avoid `act(...)` warnings.
- React Router future warnings should use the same future flags in test wrappers where applicable.

## Verification

Use focused checks after each extraction, then full gates before push:

- Backend: `npm run migrate && npm test`
- Frontend focused map: `npm test -- MapView.test.jsx`
- Frontend focused playback: `npm test -- Playback.test.jsx PlaybackVideo.test.jsx playbackSegmentSelection.test.js publicShareUrl.test.js`
- Frontend full: `npm test && npm run build && npm run lint`

## Risk Controls

- One boundary per commit.
- No behavior-preserving refactor in the same commit as a user-facing bug fix.
- Header Docs on every created or edited file.
- Update local module maps when flow ownership changes.
- Keep old public method signatures until all callers are migrated.

## Completion Criteria

- All verification gates pass.
- `cameraHealthService.js`, `cameraService.js`, `MapView.jsx`, `Playback.jsx`, and `AreaManagement.jsx` each have at least one meaningful boundary extraction or documented follow-up.
- The map layer controls remain clickable in full and simple modes at low zoom.
- New feature work can start from smaller, tested boundaries.
