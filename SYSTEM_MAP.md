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
- `docs/frontend-guide.md`, `docs/billing-rental.md`: on-demand deep-dive guides extracted from `AGENTS.md` (read only when the task touches that area, to keep auto-loaded context lean).
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

- Live public viewing: `LandingPage` -> `CameraContext`/`cameraService.getActiveCameras()` sanitized public read model -> `MapView` or landing grid -> on-demand `publicCameraResolver`/`streamService.getStreamUrls()` -> `VideoPopup`/`VideoPlayer` -> `/api/hls/*` or external stream handling.
- Public growth discovery: `/area/:areaSlug` and landing compact discovery strip use sanitized `/api/public/*` area/trending/discovery endpoints for live-now, top CCTV, popular areas, and newest cameras; public-growth cameras are resolved through `/api/stream/:id` before opening video popups when they lack standard stream URLs.
- Public PWA shell: `main.jsx` registers `/sw.js`; `site.webmanifest` exposes public workflow shortcuts and the service worker caches only safe app-shell assets while avoiding `/api/*` and `/hls/*` stream caching.
- Admin authentication: `LoginPage` -> `authService` frontend -> `/api/auth/login` -> `authController`/`authService` backend; HttpOnly cookie options are derived by `backend/utils/authCookieOptions.js` so same-origin domain and direct-IP access keep session cookies valid.
- Playback public/admin: `/playback` uses `accessScope='public_preview'`; `/admin/playback` uses `accessScope='admin_full'`; `Playback.jsx` -> `recordingService` -> recording routes -> segment stream endpoint.
- Playback tracking: media `playing`/progress starts `/api/playback-viewer/*`; changing camera/segment must stop old playback session before new tracking starts.
- Live tracking: HLS proxy/viewer routes use `/api/viewer/*`; keep live tracking separate from playback tracking.
- Camera admin: `CameraManagement.jsx` -> camera admin components/hook -> `cameraService` frontend -> camera routes/controllers -> `backend/services/cameraService.js`; recording can be enabled for recordable HLS delivery types (`internal_hls`, `external_hls`), internal RTSP transport can be overridden per camera, and thumbnail capture strategy can be set per internal camera.
- Area admin bulk policy: `AreaManagement.jsx` -> area service -> `backend/services/areaService.js` and `cameraService.bulkUpdateArea`; internal ingest and RTSP transport defaults can be set per area.
- Health monitoring: `cameraHealthService` evaluates runtime/probe status, writes runtime state, and coordinates recording/thumbnail transitions; `thumbnailService` background work refreshes only missing/stale thumbnails in a capped queue with failure backoff, uses a longer 3-hour stale window for strict on-demand internal RTSP cameras, and can use direct RTSP, internal MediaMTX HLS, or explicit HLS fallback per camera.
- Recording lifecycle: `recordingService` orchestrates FFmpeg, runtime state, segment discovery/remux/cleanup, and `recordingProcessManager`; internal RTSP FFmpeg input transport resolves from camera override -> area default -> TCP.
- Streaming proxy: `hlsProxyRoutes.js` handles internal/external HLS proxying, viewer identity/session caching, external host policy, and stream response behavior.
- Camera tenancy/segregation: `cameras.camera_class` (`community` | `owner_private` | `subscriber`) hard-splits the public hub from rented/private cameras. `backend/services/cameraAccessService.js` is the single access decision point (30s cached); every public read model filters `camera_class='community'`, and `/hls/*`, `/api/stream/:id(+/token)`, external proxies, public playback, and thumbnails gate non-community cameras to staff/owner/stream-token viewers. The `customer` role is denied-by-default on all auth-required routes except `/api/auth/*`, `/api/users/profile*`, `/api/customer/*` (`middleware/customerAccessPolicy.js`).
- Prepaid billing: `walletService` (ledger, idempotent charge refs) + `billingService` (admin camera→customer assignment, hourly idempotent daily charges in local time, suspend on empty balance → `cameras.billing_status='suspended'` kills streams ≤30s, auto-resume on top-up) + `paymentService` (manual confirm, Midtrans QRIS signature-verified webhook, or iPaymu QRIS where the unsigned callback only triggers a signed re-query before crediting — exactly-once in all drivers). Customer portal: `/my` + `/my/paket` + `/my/wallet` (CustomerLayout); admin UI: `/admin/billing`.
- Account plans & self-service: `billingPlanService` (plan catalog `billing_plans`, per-account state, trial window via `users.trial_ends_at`/`trial_used`, self-switch repricing, `/daftar` registration with unique-phone guard + admin toggle) + `customerCameraService` (self add/edit/delete bounded by plan `max_cameras`, customer RTSP URLs filtered by `utils/rtspUrlPolicy.js`). Trial: active days are charge-free in the daily tick; expiry suspends every camera until a paid plan is selected.
- Registration approval (two surfaces, one service): self-registered customers start `users.account_status='pending'` (login blocked). Admin web: `/admin/billing` → Persetujuan → `billingPlanService.approveCustomer/rejectCustomer` (clock starts on approval). Telegram: `telegramBotService` (interactive bot, long-polling — no webhook/public URL needed) pushes an approve/reject card on signup via `authController.register` → `notifyNewRegistration`, and handles button taps + `/pending`/`/customers`/`/customer`/`/stats`/`/topup`/`/suspend`/`/resume`/`/plan`. Authorization gate = `telegramService.isCommandChat` against `commandChatIds` (admin-set allow-list, empty → falls back to the monitoring chat). Bot mutations reuse the same audited billing/wallet services as the web UI. Pure formatting/encoding lives in `telegramBotPresenter`. Lifecycle: `telegramBotService.start()/stop()` in `server.js`; activates the moment a bot token is saved (idle re-check, no restart needed).
- Deployment note (rental security): MediaMTX HLS port (:8888) must NOT be publicly reachable — all viewer traffic must flow through the backend `/hls` proxy or the subscriber gating is bypassable.

## Data And Indexes

- Main DB path: `backend/data/cctv.db`; local DB files are ignored.
- Use `query()`, `queryOne()`, `execute()`, and `transaction()` from `backend/database/connectionPool.js`.
- Use parameterized SQL only.
- Timestamp standard: new persistence should prefer UTC SQL/ISO values; live/playback viewer session history currently stores configured local SQL values and must use `backend/services/timeService.js` plus explicit frontend `TIMESTAMP_STORAGE` display modes.
- Before DB-heavy feature work, check indexes/cardinality for target tables and avoid N+1 loops.
- High-traffic tables include `cameras`, `camera_runtime_state`, `viewer_sessions`, `viewer_session_history`, `playback_viewer_sessions`, `playback_viewer_session_history`, `recording_segments`, and audit/security logs.
- Public area pages use persisted `areas.slug` plus `idx_areas_slug` for stable `/area/:areaSlug` lookups.

## Verification Commands

- Backend full gate: `cd backend && npm run migrate && npm test`.
- Backend focused test: `cd backend && npm test -- <test-file>`.
- Frontend full gate: `cd frontend && npm test && npm run build && npm run lint`.
- Frontend focused test: `cd frontend && npm test -- <test-file>`.
- Frontend lint runs against full `src` via `frontend/package.json`.
- **Anti-"penumpukan" guardrails (run inside `npm test`, fail on regression):** `backend/__tests__/guardrails.test.js` + `frontend/src/__tests__/guardrails.test.js` enforce a file-size ratchet (new files <800 ln; named giants frozen at current size — may shrink, not grow), layering (routes never import the DB; services never import controllers/routes), and data-safety (no NEW `INSERT OR REPLACE`; no NEW `REAL` money column). CI: `.github/workflows/ci.yml` runs lint+test both sides on push/PR. To intentionally change a frozen baseline, edit it in the same PR so growth is a visible decision, not silent drift.

## Stabilization Priorities

- Create local `.module_map.md` files for `backend/`, `frontend/src/`, and large feature folders before major edits.
- Reduce large files before adding feature complexity:
  - `backend/services/cameraHealthService.js`
  - `backend/services/cameraService.js`
  - `frontend/src/components/MapView.jsx`
  - `frontend/src/pages/AreaManagement.jsx`
  - `frontend/src/pages/Playback.jsx`
  - `backend/services/hlsProxyService.js` and `backend/services/playbackTokenService.js` (next pile-up candidates per 2026-06-22 audit)
- Remove or archive tracked root artifacts only with explicit approval.
- ✅ Legacy duplicate frontend locations RESOLVED (2026-06): the old shims (`components/AdminLayout.jsx`, `components/LandingPageSimple.jsx`, `components/settings/`) are deleted — only canonical `layouts/AdminLayout.jsx`, `components/landing/LandingPageSimple.jsx`, `components/admin/settings/` remain (0 stale imports).
- Keep full-scope frontend lint passing before adding new feature surfaces.
- Add Header Docs to active entrypoints that still lack them before modifying those files.

## Known Rule Deviations (conformance gaps)

Snapshot from the 2026-06-09 conformance audit — places where code does not yet follow the rules in `AGENTS.md`. Do not rely on or propagate these gaps; update this list as items are fixed.

**Resolved 2026-06-09 (were live gate/security issues):**
- ✅ ~~Committed Telegram phone-home~~ — `backend/config/constants.js` no longer hardcodes the bot token/chat id; `sendInstallationNotification` is now env-opt-in (`SETUP_NOTIFY_BOT_TOKEN` / `SETUP_NOTIFY_CHAT_ID`) and OFF by default. **Owner follow-up:** change admin passwords on any deployment installed with the OLD code — `backend/database/setup.js:141` sent the generated admin username + plaintext password (+ domain/IP) to a hardcoded Telegram chat on every `npm run setup-db`.
- ✅ ~~Frontend lint RED~~ — `TelegramSettingsPanel.jsx:485` quotes escaped (`&quot;`); `npm run lint` passes.
- ✅ ~~Orphan test~~ — `recordingMaintenanceService.test.js` removed; coverage retained by `recordingMaintenanceCoordinator.test.js` + `recordingMaintenanceStateRepository.test.js`.

**Structural rule violations:**
- **DB dual-connection — hazard mitigated, full convergence deferred:** `database/database.js` now sets `busy_timeout=5000` (matching connectionPool), removing the SQLITE_BUSY asymmetry that was the concrete hazard. The 15 modules below still use its own single connection rather than `connectionPool` — full convergence is **deferred**, and is NOT a mechanical import swap: connectionPool's separate read/write connections break the read-after-write consistency those modules rely on (proven — `cameraRuntimeStateService` reads back its just-written row and gets the pre-write state). Needs a per-module audit. Modules: `adminDashboardService`, `apiKeyService`, `backupService`, `brandingService`, `bruteForceProtection`, `feedbackService`, `notificationDiagnosticsService`, `passwordExpiry`, `passwordHistory`, `saweriaService`, `settingsService`, `telegramService`, `thumbnailService`, `timezoneService`, `userService`.
- **Parameterized-SQL — hardened, full param deferred:** `viewerAnalyticsService.js` and `adminDashboardService.js` still interpolate dates into SQL, but every interpolated value now passes a strict `sqlDate()` guard (throws on anything not `YYYY-MM-DD`), so injection is structurally impossible (values were already server-generated / regex-validated). Full `?`-parameterization (10+ queries, one uses the filter twice) is **deferred** — these analytics services have no tests to verify a rewrite. `playbackViewerSessionService.js:39-55` is the correct `?`-param reference.
- ✅ **Routes not thin — RESOLVED 2026-06-09 (3 of 3):** `configRoutes.js` → `services/appConfigService.js` (route 45 lines, 0 DB); `hlsProxyRoutes.js` (was 1585) → helper/class library to `services/hlsProxyService.js`, leaving a 154-line route; `externalStreamProxyRoutes.js` (was 848) → the whole stateful SWR/dedup proxy plugin to `services/externalStreamProxyService.js` (moved byte-exact via `git mv`), leaving a thin re-export route. All importers + source-text guard tests repointed; full backend suite green. **Caveat:** the external-proxy handlers have no unit test (source-text guards + pure-helper unit tests only) — run a live stream check before relying on it in prod.
- ✅ **Frontend context perf — fixed 2026-06-09:** all 7 React contexts (`Theme`, `Toast`, `Branding`, `Timezone`, `Camera`, `Notification`, `Security`) now memoize their `value` with `useMemo`, stabilizing handlers with `useCallback` where they were recreated each render (notably `ThemeContext.toggleTheme` and `TimezoneContext`'s formatters + `loadTimezone`). Verified: lint + 487 frontend tests + build all green.
- **External URL exposure:** public read models emit `external_*_url` to anonymous clients without credential stripping (privacy / proxy-bypass — not an RTSP/credential leak).

**Partial / lower severity:**
- Area mutations lack audit logging (camera mutations have it).
- Prod env template does not set `API_KEY_REQUIRE_KEYS=true` (empty-keys-table bypass stays open).
- Auth/security services (`authService`, `authController`, `bruteForceProtection`, `sessionManager`, `apiKeyService`, `securityAuditLogger`) have no dedicated tests.
- vitest coverage has no thresholds (coverage reported, never enforced).

## Local Map Policy

- For backend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect only target module headers and create/update the local map when changing flow.
- For frontend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect page/component headers and create/update the local map when changing flow.
- For docs-only changes, read this file and the target docs folder listing.
