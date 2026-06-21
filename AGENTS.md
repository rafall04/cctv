# AGENTS.md - Agentic Coding Guidelines

This file provides guidelines for AI agents working in this repository. It is **auto-loaded every
session** (via `@AGENTS.md` in CLAUDE.md), so it stays lean on purpose — universal rules + critical
invariants only. Anything domain-specific or example-heavy lives in the on-demand guides below.

> **Current conformance gaps:** the code does not yet follow every rule below. See "Known Rule Deviations" in [SYSTEM_MAP.md](SYSTEM_MAP.md) for the precise list (with `file:line`) so you don't rely on or propagate a known gap.

## Deep-dive guides — read on demand (NOT auto-loaded, to keep context lean)

Read the matching guide **only when your task touches that area** — don't load them speculatively.

| When you are working on… | Read |
|---|---|
| Where code lives / runtime flows / verification / stabilization | [SYSTEM_MAP.md](SYSTEM_MAP.md) |
| React components, hooks, playback/landing view modes, frontend perf | [docs/frontend-guide.md](docs/frontend-guide.md) |
| Billing, subscriber/customer cameras, payment gateways, plans, registration, playback scope | [docs/billing-rental.md](docs/billing-rental.md) |
| Deployment / env-var setup / PM2 / Nginx / MediaMTX | [README.md](README.md) |
| Security policy & posture | [SECURITY.md](SECURITY.md) |
| Running DB migrations on a populated DB | [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) |

## Project Overview

RAF NET Secure CCTV Hub — a secure, high-performance video streaming system that isolates private IP
cameras from public exposure while providing public web access to camera streams.

**Tech Stack:** Backend = Node.js 20+, Fastify 4.28.1, SQLite (better-sqlite3), JWT, ES modules.
Frontend = React 18.3.1, Vite 5.3.1, Tailwind CSS 3.4.4, HLS.js, Leaflet. Streaming = MediaMTX v1.9.0
(RTSP→HLS). Exact versions live in `backend/package.json` / `frontend/package.json`.

---

## Critical Invariants (NEVER violate)

These prevent expensive, hard-to-undo mistakes (data loss, privacy leaks, billing errors). They are
small on purpose so they stay loaded every session — the *how* behind them is in the on-demand guides.

- **Public surface is community-only.** Every public query filters `camera_class = 'community'`;
  non-community (`owner_private`, `subscriber`) cameras must NEVER appear on any public surface
  (landing/map/stream list/area/trending/discovery/public playback/thumbnails). Per-camera endpoints
  (`/api/stream/:id`, `/hls/*`, proxies) gate through `cameraAccessService.canViewLive`. Detail:
  [docs/billing-rental.md](docs/billing-rental.md).
- **Never expose RTSP URLs to the frontend** — only HLS stream URLs.
- **Money is INTEGER rupiah, never float.**
- **`customer` role is denied-by-default** on every auth-required endpoint except the whitelist in
  `middleware/customerAccessPolicy.js` (`/api/auth/*`, `/api/users/profile*`, `/api/customer/*`).
- **Subscriber product is live-only** — no public playback, no playback-token access, recordings stay staff-only.
- **Production DB safety** — never mutate the prod DB to "verify"; never `INSERT OR REPLACE` ad-hoc
  rows; always back up `data/cctv.db` first. Full rationale in [Database](#database) below (real incident).
- **Parameterized SQL only** — `?` placeholders, never string-interpolate user/values into SQL.

---

## Build, Lint, and Test Commands

```bash
# Backend (cd backend)
npm install
npm run dev              # dev server (nodemon hot reload)
npm start                # production server
npm run setup-db         # initialize database
npm run migrate          # run all migrations (run BEFORE restarting backend after schema changes)
npm run migrate-security # security migrations
npm test                 # all tests (vitest --run)
npm run test:watch
npm test -- cameraHealthService.test.js              # single file
npm test -- cameraHealthService.test.js -t "name"    # single test

# Frontend (cd frontend)
npm install
npm run dev              # Vite dev server
npm run build            # production build
npm run preview
npm run lint             # ESLint over src (max-warnings 0)
npm test                 # all tests (vitest run)
npm test -- CameraManagement.test.jsx                # single file
npm test -- CameraManagement.test.jsx -t "name"      # single test
```

**Verification gates** (run before committing a change in that area):
- Backend: `cd backend && npm run migrate && npm test`
- Frontend: `cd frontend && npm test && npm run build && npm run lint`

---

## Code Style Guidelines

### General Principles

- ES modules (import/export). 4 spaces, not tabs. Single quotes. `async/await` over raw promises.
- `console.log` for debugging; structured logging via pino-pretty in production.
- Attach `error.statusCode` to thrown errors for HTTP status (e.g. `err.statusCode = 404`).

### Backend (Node.js/Fastify)

- **File naming:** camelCase — `cameraController.js`, `mediaMtxService.js`, `authMiddleware.js`.
- **Imports:** relative with `.js` extension; group external libs → internal services → middleware → database.
- **Functions:** named exports for route handlers; class-based services (`export default new XService()`).
- **DB access:** `query()` for SELECT, `queryOne()` for single row, `execute()` for INSERT/UPDATE/DELETE;
  always parameterized with `?`.
- **Errors:** attach `statusCode`; return `{ success: boolean, message?, data? }`.

```javascript
// Controller — named export, async handler
export async function getCameraById(request, reply) {
    try {
        const camera = cameraService.getCameraById(request.params.id);
        return reply.send({ success: true, data: camera });
    } catch (error) {
        console.error('Get camera error:', error);
        const code = error.statusCode || 500;
        return reply.code(code).send({ success: false, message: code === 500 ? 'Internal server error' : error.message });
    }
}
// Service — class-based; throw with statusCode
class CameraService {
    getCameraById(id) {
        const camera = queryOne('SELECT * FROM cameras WHERE id = ?', [id]);
        if (!camera) { const err = new Error('Camera not found'); err.statusCode = 404; throw err; }
        return camera;
    }
}
```

### Frontend (React)

- **File naming:** PascalCase components (`VideoPlayer.jsx`); camelCase utils/hooks (`useFormValidation.js`).
- Functional components + hooks; named exports for pages, default exports for reusable components.
- **All hooks BEFORE any conditional return** (React Error #310). Import order: React → external → components → hooks/utils → styles.
- React Context for global state (theme/notifications/branding); local `useState` for component state.
- Forms via `useFormValidation`. **Tailwind only** — semantic classes, theme colors (`primary`, `dark-*`, `light-*`). Wrap risky trees in `ErrorBoundary`.
- Full examples + hook/race-condition/URL-param/perf patterns → [docs/frontend-guide.md](docs/frontend-guide.md).

---

## API Response Format

```javascript
{ success: true, data: [...] }                                    // success
{ success: true, message: 'Camera created successfully', data: {...} } // success + message
{ success: false, message: 'Error description' }                  // error
```

---

## Security Guidelines

- JWT auth: short-lived access token (~1h, `JWT_EXPIRATION`) + refresh-token rotation (~7d). bcrypt password hashing.
- Rate-limit auth endpoints. Validate and sanitize all inputs. CSRF protection for state-changing operations.
- Log security events via `securityAuditLogger`. (See also: Critical Invariants above, [SECURITY.md](SECURITY.md).)

---

## Testing

- Backend tests in `__tests__/` (node env). Frontend tests co-located as `*.test.jsx`/`*.spec.jsx` (jsdom; only `setup.js` lives in `src/__tests__/`).
- vitest for both. Use property-based testing with `fast-check` for critical logic.

---

## Database

- SQLite with better-sqlite3 (synchronous API). DB at `backend/data/cctv.db`. Migrations in `backend/database/migrations/`.
- Table names snake_case: `cameras`, `areas`, `users`. Use `query()`/`queryOne()`/`execute()`/`transaction()` from `database/connectionPool.js`.

### Production data safety (LEARNED FROM A REAL INCIDENT — a customer row was lost)

- **NEVER mutate the production DB to "verify" a change.** No inserting/deleting temp rows on the live
  DB. Verify via the API with a throwaway/test account, or inside a transaction you **ROLL BACK**, or
  against a **copy** of `cctv.db`. (Root cause: a verify script inserted temp users with explicit high
  IDs, bumping `AUTOINCREMENT`; a real customer then registered into that same ID and was overwritten +
  deleted by the script's `INSERT OR REPLACE` + `DELETE`.)
- **NEVER use `INSERT OR REPLACE` for ad-hoc/test rows.** On ANY primary-key or UNIQUE conflict it
  silently **DELETES** the conflicting (possibly real) row first. Use plain `INSERT` (fails loudly) or
  `INSERT OR IGNORE`. Never hand-pick explicit IDs that can collide with the autoincrement range.
- **Always back up `data/cctv.db` before any manual DB operation** and keep the pre-op copy.
- Defense-in-depth: a subscriber camera whose owner no longer exists is auto-healed (unpublished +
  suspended, never left public) on backend boot by `billingService.healOrphanedSubscriberCameras()`
  (also `POST /api/admin/billing/heal-orphans`). Prevention above is still the real safeguard.

---

## Environment Configuration

- Backend: `backend/.env`. Frontend: `frontend/.env` (prefix vars with `VITE_`). All config via env vars, no hardcoded values.

---

## Common Patterns

- **Cache invalidation** after mutations: `invalidateCache('/api/cameras')` from `middleware/cacheMiddleware.js`.
- **Audit logging** for admin actions: `logCameraCreated(userId, cameraId, cameraName, request)` from `services/securityAuditLogger.js`.
- **File paths:** use `path.resolve`; store relative to project root.
- **Admin CRUD pages:** reuse a `useCRUD(endpoint)` hook exposing `{ data, loading, error, fetchAll, create, update, remove }`.
- **Playback vs live tracking** must stay separate, and **frontend view-mode/URL-param** rules → [docs/frontend-guide.md](docs/frontend-guide.md) + [docs/billing-rental.md](docs/billing-rental.md).

---

## Git & Version Control

**Push after every task — even the smallest change** (typo, copy, spacing, Tailwind class, test, small refactor, light config).

1. `git status` first — verify only the intended files are staged. If unrelated changes exist, stage only the relevant files (don't blanket `git add .`).
2. Finish the relevant verification gate before committing.
3. Commit with a clear message: `"Add: …"`, `"Fix: …"`, or `"Refactor: …"`.
4. `git push` to the active working branch. Done = pushed to GitHub, not just committed locally.

```bash
git status
git add <changed-files>
git commit -m "Fix: perbaiki status bar MapView"
git push
```
