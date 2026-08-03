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
- `backend/recorder.js`: standalone recording worker (pm2 app `<client>-cctv-recorder`), enabled by `RECORDING_WORKER_ENABLED=true`. Owns all FFmpeg recorders so restarting the API never touches recording. Coordinates with the API purely through SQLite (WAL): the API queues `recording_reconcile_requests`, the worker publishes `recording_process_state` + `recording_health_snapshot`.
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
- `frontend/src/layouts/AdminLayout.jsx`: Active admin shell (the old `components/AdminLayout.jsx` shim has been removed).
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
- **Boot smoke (`__tests__/bootSmoke.test.js`) — runs inside `npm test`:** actually spawns `server.js` and
  `recorder.js` as real processes against a throwaway copy of the DB (every camera disabled, so no ffmpeg
  and nothing real is touched), then requires each to reach its explicit end-of-boot marker
  (`[Server] Startup complete` / `[Recorder] Worker ready`) and still be alive after that. This is the only
  test that executes the entry points at all — unit tests mock the module graph, so they proved every piece
  worked in isolation while `0413b4b` crash-looped production for 7h36m. **Do not weaken it into a
  fixed-duration wait**: an earlier version waited 12s after `/health` and PASSED with that exact bug
  reintroduced, because `/health` answers at t=3.2s and the crash lands at t=23.4s.
- Backend focused test: `cd backend && npm test -- <test-file>`.
- Frontend full gate: `cd frontend && npm test && npm run build && npm run lint`.
- Frontend focused test: `cd frontend && npm test -- <test-file>`.
- Frontend lint runs against full `src` via `frontend/package.json`.
- **Anti-"penumpukan" guardrails (run inside `npm test`, fail on regression):** `backend/__tests__/guardrails.test.js` + `frontend/src/__tests__/guardrails.test.js` enforce a file-size ratchet (new files <800 ln; named giants frozen at current size — may shrink, not grow), layering (routes never import the DB; services never import controllers/routes), data-safety (no NEW `INSERT OR REPLACE`; no NEW `REAL` money column), an auth test-count floor, and doc-lint (governance docs must reference only existing files). CI: `.github/workflows/ci.yml` runs lint+test both sides on push/PR. To intentionally change a frozen baseline, edit it in the same PR so growth is a visible decision, not silent drift.
- ⚠️ **Focused runs skip the guardrails**: `npm test -- <file>` filters them out, so a ratchet/doc-lint breach only surfaces in the full suite (or CI). While iterating on a frozen file, add `guardrails` to the filter. The ratchet counts every line **including comments** — `MapView.jsx` sits 1 line under its frozen ceiling, so shrink changes there rather than raising the baseline.
- **Real-browser overflow smoke:** `cd frontend && npm run build && npm run test:e2e` runs `frontend/e2e/overflow.spec.js` (Playwright, Pixel-class viewport, all `/api/*` mocked, external hosts blocked) asserting no public page overflows horizontally at normal and 1.5× font scale — the layout class jsdom cannot see. Also a dedicated `e2e` job in CI. Frontend guardrails additionally pin the mobile-viewport invariants (`minimum-scale=1.0`, `overflow-x: clip`, the ad-iframe clamp, no `fixed`+`100vw`, no `w-screen`) and ratchet legacy `-gray-N` usage downward from its measured baseline.

## Stabilization Priorities

- Local `.module_map.md` files exist for `backend/`, `backend/services/`, `backend/utils/`, and `frontend/src/` — keep them in sync when changing flow (doc-lint fails on references to deleted files); create one for any large feature folder that still lacks it before major edits.
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
- ✅ **DB dual-connection — RESOLVED 2026-08-03. `database/database.js` is deleted; `connectionPool` is the only DB layer.** All 17 importers (the deviation list said 15; it missed `backupTelegramService` and `telegramDocumentSender`) now read through `connectionPool`. A guardrail in `__tests__/guardrails.test.js` fails if the file or an import of it comes back.
  - **The reason it was deferred was measured, and it was wrong.** The old note claimed connectionPool "breaks read-after-write" generally. It does not: with a real SQLite file, a write followed by a read **outside** a transaction is visible — the readonly pool sees the latest committed snapshot. The breakage was confined to reads **inside** an open `transaction()`, where the rows are not committed yet and the readonly connections cannot see them. That distinction is what turned a 17-module rewrite into an import swap.
  - **The enabler:** `connectionPool.query`/`queryOne` now serve reads from the write connection whenever `writeConnection.inTransaction` is true, giving it the same read-your-own-writes guarantee `database.js` had on its single connection. Pinned by `__tests__/connectionPoolIsolation.test.js`, which runs against a real temp SQLite file — every other DB test mocks the connection layer, which is precisely why this class of bug survived so long.
  - **What it cost in production before the fix:** `cameraHealthService` upserts runtime state for every camera inside one `transaction()`; the read-back returned undefined and the log filled with 22 × `[CameraHealth] Check failed: Cannot read properties of undefined (reading 'last_runtime_signal_at')`. Sharing the transaction meant one camera rolled back every camera's state that tick. `ensureRuntimeState` additionally returns the values it just wrote (contract: never undefined when the table exists) and the monitoring stage isolates per-camera failures.
  - **Also measured, and also not what the header claimed:** the read pool never grows past ONE connection. better-sqlite3 is synchronous, so a query always releases before the next one asks; after 20 consecutive queries `readPoolSize` is 1. The "60-80% faster" claim in that file's header was never achievable by that design and has been removed.
  - One deliberate exception: `backupTelegramService` reaches for `pool.getWriteConnection()` directly, because `VACUUM INTO` needs a real read-write handle the readonly pool cannot provide.
- ✅ **Parameterized-SQL — RESOLVED 2026-08-03.** `viewerAnalyticsService.js` and `adminDashboardService.js` now bind every date; no value is pasted into SQL text anywhere in the backend. The blocker was "these analytics services have no tests to verify a rewrite", so the tests came first — and the shape of them was the whole trick: **asserting on the SQL string would have been worse than nothing**, because the rewrite changes the SQL by design (such a test fails for the right change and passes for a wrong one). Instead `__tests__/viewerAnalyticsService.test.js` runs the real service against a real SQLite file seeded with rows deliberately lopsided across periods, so a filter that silently matched everything or nothing cannot pass by coincidence. Twelve behaviour tests were written first and passed against the OLD code; the same twelve passing after the rewrite is the proof. (They immediately caught a call site the rewrite missed.) `adminDashboardService` is covered by capturing the bound params per period. `sqlDate()` is kept — not for injection any more, but because it turns a malformed date into a named error instead of an empty result set that reads as "no traffic that day".
  - Found while verifying the rewrite against production data: `date:2026-13-99` passed the `^\d{4}-\d{2}-\d{2}$` shape check, produced an Invalid Date, and `toISOString()` threw a RangeError that `getAnalytics`' own catch swallowed — the admin saw a blank dashboard with only a stack trace to explain it. `2026-02-30` failed differently again (JavaScript rolls it to 2026-03-02). Both now round-trip-check and fall back to the 7-day window.
- ✅ **Routes not thin — RESOLVED 2026-06-09 (3 of 3):** `configRoutes.js` → `services/appConfigService.js` (route 45 lines, 0 DB); `hlsProxyRoutes.js` (was 1585) → helper/class library to `services/hlsProxyService.js`, leaving a 154-line route; `externalStreamProxyRoutes.js` (was 848) → the whole stateful SWR/dedup proxy plugin to `services/externalStreamProxyService.js` (moved byte-exact via `git mv`), leaving a thin re-export route. All importers + source-text guard tests repointed; full backend suite green. **Caveat:** the external-proxy handlers have no unit test (source-text guards + pure-helper unit tests only) — run a live stream check before relying on it in prod.
- ✅ **Frontend context perf — fixed 2026-06-09:** all 7 React contexts (`Theme`, `Toast`, `Branding`, `Timezone`, `Camera`, `Notification`, `Security`) now memoize their `value` with `useMemo`, stabilizing handlers with `useCallback` where they were recreated each render (notably `ThemeContext.toggleTheme` and `TimezoneContext`'s formatters + `loadTimezone`). Verified: lint + 487 frontend tests + build all green.
- **External URL exposure:** public read models emit `external_*_url` to anonymous clients without credential stripping (privacy / proxy-bypass — not an RTSP/credential leak).

**Operational invariants learned from the 2026-08-03 production audit** (the box was ~60 days from destroying its own footage):

- **Never relay FFmpeg output line-for-line into a pm2 log.** The stderr tailer delivers *chunks*, not lines; classifying a chunk as one line and printing it whole turned FFmpeg's info chatter into 1.4 GB/day (2.9 GB in 2.5 days). pm2 logs share the filesystem with `recordings/`, and the emergency disk guard reclaims space by **deleting recordings** — so unbounded logging is a data-loss path, not just noise. Recording FFmpeg now runs `-hide_banner -loglevel error -stats`; **`-stats` is load-bearing** (it forces the progress line out via a direct stderr write, keeping `recordingHealthMonitor`'s freeze heartbeat alive at a level `av_log` would swallow). `pm2-logrotate` is installed on production (50M / retain 7 / compress / 30s worker).
- **Segment completion is NOT detected from FFmpeg stderr in practice.** Production emitted `Closing` 0 times and `[FFmpeg] Detected segment completion` 0 times across 2.5 days while writing 771+ segments — `recordingRecoveryScanner` polling the pending directory is the mechanism that actually works. The stderr path is a fast-path that never fires; do not assume it is load-bearing.
- **`telegram_archive_uploads` must never be pruned.** It reads like an upload journal and grows ~4,800 rows/day, which makes it the obvious next retention candidate. It is the *index into the Telegram archive*: local retention is 4 hours and `archivedSegmentSourceService` reaches everything older through its `file_id`. All production rows are `status='ok'` with a live `file_id` — there is no failed-upload subset to reclaim. Growth is handled by `idx_tg_archive_camera_recorded`, never by DELETE. Guarded by `__tests__/operationalRetentionService.test.js`.
- **The recorder CAN be restarted safely.** It re-adopts running FFmpeg through `recording_process_state` — verified on production: `Adopted 31 recorder(s) still running from the previous instance`, ffmpeg count 31 → 31, no segment interrupted. Restarting it is how recorder-side code changes take effect.

**Partial / lower severity:**
- Area mutations lack audit logging (camera mutations have it).
- Prod env template does not set `API_KEY_REQUIRE_KEYS=true` (empty-keys-table bypass stays open).
- ✅ ~~Auth/security services have no dedicated tests~~ — resolved 2026-06 (47-test front-door backfill, commit c6107f5); a test-count floor in `backend/__tests__/guardrails.test.js` now blocks silent deletion (`authService`≥10, `sessionManager`≥10, `bruteForceProtection`≥10, `apiKeyService`≥8). ✅ `securityAuditLogger` covered 2026-08-03 (`__tests__/securityAuditLogger.test.js`, 23 tests against a real SQLite file, `securityAuditLogger≥15` added to the same floor). It was the last service in that perimeter with no tests at all, which was backwards: it is what records whether the other controls did anything. The tests pin the parts a mock cannot judge — filtering, pagination, retention cutoffs, SQL metacharacters in the admin search box treated as literal text — plus the rule that the audit trail must never take down what it audits: with the table missing, the event goes to the console and a failed login is still refused.
- `backend/services/backupService.js:111` uses `INSERT OR REPLACE` in its restore path. Pre-dates the data-safety rule (the guardrail only bans NEW occurrences). On any PK/UNIQUE conflict it silently deletes the conflicting row first — acceptable-by-design for restore-over-existing, but never copy this pattern, and audit it before restoring onto a live DB.
- **Legacy grey styling debt — largely closed 2026-07-27:** the admin surface was the last un-migrated territory (it held 4,630 of the 5,292 raw `gray-*` in the tree, 87%). It was swept by matching exact light+`dark:` PAIRS *inside a single `className`* and mapping each pair to the role whose light AND dark values sit closest — never by collapsing a lone grey, since an unpaired grey is a judgement call about which role was meant. Tree-wide count: **5,292 → ~500**, and `guardrails.test.js` BASELINE was lowered in the same pass to lock it in. The remainder is exactly those unpaired singletons; resolve them by hand as pages are touched (an unpaired grey is usually also a dark-mode bug). Admin pages now compose from `components/ui` primitives — read `components/ui/.module_map.md` before writing a new class string.
- vitest coverage has no thresholds (coverage reported, never enforced; the guardrail test-count floor above is the interim substitute).

## Local Map Policy

- For backend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect only target module headers and create/update the local map when changing flow.
- For frontend changes, read this file plus the nearest `.module_map.md` if present; if absent, inspect page/component headers and create/update the local map when changing flow.
- For docs-only changes, read this file and the target docs folder listing.
