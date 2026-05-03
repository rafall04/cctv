<!--
Purpose: Root navigation map for RAF NET Secure CCTV Hub so agents can enter the codebase without blind scans.
Caller: Agents and maintainers before modifying backend, frontend, deployment, or documentation flows.
Deps: AGENTS.md, README.md, backend/package.json, frontend/package.json, docs/superpowers plans/specs.
MainFuncs: Maps top-level modules, critical runtime flows, verification commands, and known stabilization priorities.
SideEffects: None; documentation only.
-->

# SYSTEM_MAP.md

## Project Shape

- `backend/`: Fastify API, SQLite migrations/data access, MediaMTX orchestration, recording, health, analytics, and security services.
- `frontend/`: React/Vite public CCTV UI, admin panel, playback UI, analytics pages, settings, and shared services/hooks.
- `deployment/`: aaPanel, PM2, Nginx, environment generation, and deployment scripts/config.
- `mediamtx/`: MediaMTX runtime/config assets.
- `docs/superpowers/`: Approved specs, implementation plans, and stabilization reports.
- Root import/export JSON, `tmp_*`, `.apk`, `.sec`, `.dec.txt`, and local backup files are operational artifacts; do not add new ones to commits.

## Backend Entry Points

- `backend/server.js`: Fastify bootstrap, global middleware order, route registration, background services, startup/shutdown.
- `backend/routes/*.js`: HTTP route wiring. Keep route files thin; route behavior should delegate to controllers/services.
- `backend/controllers/*.js`: Request/response handlers and API response shaping.
- `backend/services/*.js`: Domain logic for cameras, health, streaming, recording, analytics, settings, security, and thumbnails.
- `backend/database/connectionPool.js`: Shared SQLite read/write access helpers.
- `backend/database/migrations/`: Schema/index changes. Run `npm run migrate` after schema changes.
- `backend/__tests__/`: Vitest backend coverage.

## Frontend Entry Points

- `frontend/src/App.jsx`: Route tree, providers, protected admin routes, public playback/admin playback scope split.
- `frontend/src/pages/`: Page-level orchestration for public landing, admin CRUD, playback, recording, analytics, and settings.
- `frontend/src/components/landing/`: Public landing sections, filters, cards, map/playback panels.
- `frontend/src/components/playback/`: Playback presentation components.
- `frontend/src/components/admin/`: Admin-specific cards, analytics, camera, recording, feedback, and settings panels.
- `frontend/src/layouts/AdminLayout.jsx`: Active admin shell. Prefer this over legacy `frontend/src/components/AdminLayout.jsx`.
- `frontend/src/hooks/`: Page/data hooks. Prefer extracting page state here before expanding large pages.
- `frontend/src/services/`: API clients and domain service wrappers.
- `frontend/src/utils/`: Pure helpers for share URLs, playback segment selection, map coordinates, delivery, validation, and stream logic.

## Critical Runtime Flows

- Live public viewing: `LandingPage` -> `CameraContext`/camera services -> `MapView` or landing grid -> `VideoPopup`/`VideoPlayer` -> `/api/hls/*` or external stream handling.
- Admin authentication: `LoginPage` -> `authService` frontend -> `/api/auth/login` -> `authController`/`authService` backend; HttpOnly cookie options are derived by `backend/utils/authCookieOptions.js` so same-origin domain and direct-IP access keep session cookies valid.
- Playback public/admin: `/playback` uses `accessScope='public_preview'`; `/admin/playback` uses `accessScope='admin_full'`; `Playback.jsx` -> `recordingService` -> recording routes -> segment stream endpoint.
- Playback tracking: media `playing`/progress starts `/api/playback-viewer/*`; changing camera/segment must stop old playback session before new tracking starts.
- Live tracking: HLS proxy/viewer routes use `/api/viewer/*`; keep live tracking separate from playback tracking.
- Camera admin: `CameraManagement.jsx` -> camera admin components/hook -> `cameraService` frontend -> camera routes/controllers -> `backend/services/cameraService.js`; recording can be enabled for recordable HLS delivery types (`internal_hls`, `external_hls`).
- Area admin bulk policy: `AreaManagement.jsx` -> area service -> `backend/services/areaService.js` and `cameraService.bulkUpdateArea`.
- Health monitoring: `cameraHealthService` evaluates runtime/probe status, writes runtime state, and coordinates recording/thumbnail transitions.
- Recording lifecycle: `recordingService` orchestrates FFmpeg, runtime state, segment discovery/remux/cleanup, and `recordingProcessManager`.
- Streaming proxy: `hlsProxyRoutes.js` handles internal/external HLS proxying, viewer identity/session caching, external host policy, and stream response behavior.

## Data And Indexes

- Main DB path: `backend/data/cctv.db`; local DB files are ignored.
- Use `query()`, `queryOne()`, `execute()`, and `transaction()` from `backend/database/connectionPool.js`.
- Use parameterized SQL only.
- Before DB-heavy feature work, check indexes/cardinality for target tables and avoid N+1 loops.
- High-traffic tables include `cameras`, `camera_runtime_state`, `viewer_sessions`, `viewer_session_history`, `playback_viewer_sessions`, `playback_viewer_session_history`, `recording_segments`, and audit/security logs.

## Verification Commands

- Backend full gate: `cd backend && npm run migrate && npm test`.
- Backend focused test: `cd backend && npm test -- <test-file>`.
- Frontend full gate: `cd frontend && npm test && npm run build && npm run lint`.
- Frontend focused test: `cd frontend && npm test -- <test-file>`.
- Frontend lint runs against full `src` via `frontend/package.json`.

## Stabilization Priorities

- Create local `.module_map.md` files for `backend/`, `frontend/src/`, and large feature folders before major edits.
- Reduce large files before adding feature complexity:
  - `backend/services/cameraHealthService.js`
  - `backend/services/cameraService.js`
  - `frontend/src/components/MapView.jsx`
  - `backend/services/recordingService.js`
  - `frontend/src/pages/AreaManagement.jsx`
  - `frontend/src/pages/Playback.jsx`
  - `backend/routes/hlsProxyRoutes.js`
- Remove or archive tracked root artifacts only with explicit approval.
- Resolve legacy duplicate frontend locations:
  - Prefer `frontend/src/layouts/AdminLayout.jsx`; phase out `frontend/src/components/AdminLayout.jsx`.
  - Prefer `frontend/src/components/landing/LandingPageSimple.jsx`; phase out `frontend/src/components/LandingPageSimple.jsx`.
  - Prefer `frontend/src/components/admin/settings/`; `frontend/src/components/settings/` now contains compatibility re-exports only.
- Keep full-scope frontend lint passing before adding new feature surfaces.
- Add Header Docs to active entrypoints that still lack them before modifying those files.

## Local Map Policy

- For backend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect only target module headers and create/update the local map when changing flow.
- For frontend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect page/component headers and create/update the local map when changing flow.
- For docs-only changes, read this file and the target docs folder listing.
