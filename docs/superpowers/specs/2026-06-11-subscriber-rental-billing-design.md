<!--
Purpose: Design the subscriber CCTV rental product (live-only, Rp15-25k/camera/month) with camera
         class segregation and prepaid wallet billing on top of the existing public hub.
Caller: Product/implementation planning before tenancy + billing code changes.
Deps: SYSTEM_MAP.md, AGENTS.md, existing stream/proxy/auth/admin flows.
MainFuncs: Defines camera_class model, customer role, stream gating, wallet/QRIS billing, portal.
SideEffects: Documentation only.
-->

# Subscriber Rental & Prepaid Billing Design

## Goal

Add a commercial rental layer: customers pay ~Rp15.000-25.000/camera/month for **live-only**
access to their own cameras, while the existing community/public hub keeps working unchanged.
One codebase, one deployment — but rented cameras are **hard-segregated** from public surfaces.

Key business constraints that shape the design:

1. Margin at Rp15-25k only survives with **no transcode** (copy/remux only), **on_demand idle
   shutdown** (already in place via `hlsAlwaysRemux: no`), and **bounded concurrent viewers**.
2. Ingest stays **RTSP pull** (existing `private_rtsp_url` flow). Customers must make their
   camera reachable (port-forward/DDNS/static IP). No new ingest pipeline.
3. Billing is **prepaid wallet + QRIS top-up** (micro amounts; recurring auto-debit is not
   practical in ID). Daily prorated deduction, suspend on empty balance, auto-resume on top-up.

## Data Model

### Migration `zz_20260611_add_subscriber_tenancy.js`

`cameras` gains (idempotent ALTERs gated on PRAGMA table_info):

| column           | type / default              | meaning                                              |
|------------------|-----------------------------|------------------------------------------------------|
| `owner_user_id`  | INTEGER NULL                | NULL = platform/community camera; else owning user   |
| `camera_class`   | TEXT NOT NULL `'community'` | `community` \| `owner_private` \| `subscriber`       |
| `billing_status` | TEXT NULL                   | `active` \| `suspended` — only meaningful for `subscriber` |

`users` gains `phone TEXT`, `email TEXT`. `users.role` now allows `customer`
(schema enum: `admin` | `viewer` | `customer`).

Indexes: `idx_cameras_camera_class`, `idx_cameras_owner_user_id`.

### Migration `zz_20260611b_add_billing_tables.js`

All money columns are **INTEGER rupiah** (never float).

- `wallets(id, user_id UNIQUE NOT NULL, balance INTEGER NOT NULL DEFAULT 0, updated_at)`
- `wallet_transactions(id, user_id, type 'topup'|'charge'|'refund'|'adjustment', amount signed,
  balance_after, reference, note, created_at)` + partial UNIQUE index on `reference` where
  `type='charge'` → daily-charge idempotency at the DB layer.
- `payments(id, user_id, gateway, gateway_ref UNIQUE, amount, status
  'pending'|'paid'|'expired'|'failed'|'cancelled', qris_payload, expires_at, paid_at,
  created_at, updated_at)`
- `camera_subscriptions(id, camera_id UNIQUE, user_id, monthly_price INTEGER, status
  'active'|'suspended'|'cancelled', activated_at, suspended_at, last_charged_date TEXT
  (YYYY-MM-DD, server-local Asia/Jakarta), created_at, updated_at)`

## Access Model (the anti-leak core)

`backend/services/cameraAccessService.js` is the **single decision point**:

- `getAccessInfo(cameraId)` / `getAccessInfoByStreamKey(key)` — 30s in-memory cached
  `{id, camera_class, billing_status, owner_user_id, enabled}` rows; invalidated on camera
  mutation and billing transitions.
- `canViewLive({ info, user, streamToken })`:
  - `community` → always true (public hub unchanged).
  - `owner_private` → staff (`admin`/`viewer`) or `user.id === owner_user_id` or valid
    stream token bound to the camera.
  - `subscriber` → same as owner_private **AND** `billing_status === 'active'`
    (admin/viewer staff bypass the billing gate for ops).

### Public surfaces filtered to `camera_class='community'`

| surface | file |
|---|---|
| Landing/grid list | `cameraService.getPublicLandingCameraList` |
| Map list | `cameraService.getPublicMapCameraList` |
| Public streams list `GET /api/stream` | `streamService.getAllActiveStreams` |
| Area pages / trending / discovery | `publicGrowthService` (3 queries) |
| Public area camera counts | `areaService.getAllAreas` public variant |
| Public playback (segments/stream/playlist) | `recordingPlaybackService` — non-community treated as `admin_only` deny |

### Per-camera gates (single camera endpoints)

- `GET /api/stream/:cameraId` + `GET /api/stream/:cameraId/token` → `optionalAuthMiddleware`;
  non-community requires `canViewLive` (owner/staff; subscriber must be billing-active),
  else 403/402. Issued stream tokens stay 1h; suspension is enforced at the proxy.
- `/hls/*` proxy → for non-community stream keys, require valid stream token
  (`?token=`) **or** staff/owner JWT cookie; subscriber suspended → 402. Gated playlists are
  rewritten so `?token=` propagates to child playlists, `#EXT-X-MAP` init URIs, and segments.
  Community streams: zero behavior change (no rewrite, no token requirement).
- External proxy endpoints (`/api/stream/:id/external.m3u8`, `/hls/proxy?cameraId=`) → same
  `canViewLive` check at entry.
- Thumbnails `/api/thumbnails/:file` → scoped hook: files belonging to non-community cameras
  require staff/owner cookie.

### Customer role lockout (deny-by-default)

`authMiddleware` marks `request.authWasRequired = true`. A global `preHandler` hook
(`middleware/customerAccessPolicy.js`) rejects `role === 'customer'` on **any** auth-required
route unless it is whitelisted (`/api/auth/*`, `/api/users/profile`,
`/api/users/change-own-password`, `/api/customer/*`). New staff endpoints are therefore
customer-proof by default — no per-route sweep needed, today or in the future.
Existing `viewer` (staff read-only) role is untouched.

## Billing Engine

- `walletService` — `credit`/`debit` inside better-sqlite3 transactions writing wallet +
  ledger row atomically; debit throws 402 on insufficient balance.
- `billingService.runDailyCharges()` — hourly tick (cheap SELECT), guarded by
  `last_charged_date < today` so restarts/multi-runs are idempotent (plus the DB-level unique
  charge reference). Per active subscription: `dailyCost = round(monthly_price / 30)`;
  insufficient balance → subscription + camera `suspended` (stream dies ≤30s later via access
  cache TTL). Suspended subscriptions auto-resume (and charge) when balance allows — checked
  both by the hourly tick and immediately after any wallet credit.
- `paymentGatewayService` — driver by env `BILLING_GATEWAY`:
  - `manual` (default): top-up request → admin confirms (`mark-paid`) → wallet credited.
  - `midtrans`: QRIS via Snap API (env `MIDTRANS_SERVER_KEY`), webhook
    `POST /api/billing/webhook/midtrans` verified by SHA-512 signature; webhook path added to
    CSRF skip + API-key public lists.
  Credits are keyed by `payment:{id}` reference; double webhooks can't double-credit.

## API Surface

Customer (`/api/customer/*`, auth + role customer/admin):
`GET cameras` (sanitized own cameras + subscription + live URL info), `GET wallet`,
`GET transactions`, `POST topup`, `GET topup/:id`, `GET summary`.

Admin (`/api/admin/billing/*`, requireAdmin): `GET/POST customers`, `POST topup-manual`,
`GET/POST subscriptions` (assign camera→customer: sets `owner_user_id`,
`camera_class='subscriber'`, `billing_status='active'`), `PUT subscriptions/:id`
(price/suspend/resume/cancel), `GET payments`, `POST payments/:id/mark-paid`,
`POST charges/run` (ops trigger), `PUT cameras/:id/class` (set `owner_private`/`community`).

## Frontend

- Login redirect by role: customer → `/my`, staff → `/admin/dashboard`.
- `/my` portal (CustomerLayout): **Kamera Saya** (live player w/ stream token; suspended
  banner) and **Saldo & Tagihan** (balance, daily cost, est. days left, top-up QRIS/manual,
  ledger history). Live-only — no playback for subscribers by design.
- Admin: new `/admin/billing` page (customers, subscriptions, payments, manual top-up);
  UserManagement role dropdown gains `customer` + phone/email fields.

## V2 addendum — plans, trial, self-service, iPaymu (same day)

- **Account plans** (`billing_plans`): per-camera monthly price + `max_cameras` cap + optional
  trial (`is_trial`, `trial_days`). Admin CRUD at `/admin/billing` → Paket & Trial; price edits
  reprice every live subscription of users on that plan. Users carry `plan_id`,
  `plan_started_at`, `trial_ends_at`, `trial_used`.
- **Trial semantics**: active trial days are charge-free (daily tick skips the wallet);
  expiry suspends all the user's cameras regardless of balance — recovery is choosing a paid
  plan (switch reprices + resumes through the normal charge path). Trial is once per account
  (`trial_used`); admin may re-grant. Self-registration requires a unique phone number to
  raise the cost of trial farming.
- **Self-service cameras**: customers add/edit/delete their own cameras within
  `plan.max_cameras`. Customer-supplied RTSP URLs pass `utils/rtspUrlPolicy.js`: rtsp/rtsps
  only, loopback/link-local/multicast literals and the `BILLING_RTSP_BLOCKED_HOSTS` env list
  blocked; RFC1918 stays ALLOWED because RAF NET's cameras legitimately live on ISP-private
  ranges. Residual SSRF risk (hostnames, DNS rebinding) accepted for v1 — admins can audit
  self-added cameras in the camera list.
- **Self-registration**: `/daftar` → `POST /api/auth/register` (CSRF + auth rate-limit bucket,
  API-key-exempt), lands on the admin-configured default plan; toggle + default plan live in
  settings (`billing_registration_enabled`, `billing_default_plan_key`).
- **iPaymu driver** (`BILLING_GATEWAY=ipaymu`): direct QRIS via API v2 with the documented
  HMAC-SHA256 signature; callbacks are unsigned so the webhook treats the body as a hint and
  re-queries the transaction (signed) before exactly-once crediting; customer status polls do
  the same re-check (15s throttle) so webhook-less deployments still confirm.

## Out of scope (deliberate, phase 4+)

Concurrent-viewer caps per camera, per-tenant egress metering, WA/Telegram low-balance
reminders, self-service camera onboarding (admin assigns cameras for now), invoices/receipts,
substream selection. **Deployment note:** MediaMTX HLS port (:8888) must not be publicly
reachable — all viewer traffic must flow through the backend `/hls` proxy or gating is moot.

## Success Criteria

- Public landing/map/area/trending/playback/streams list never contain a non-community camera.
- Customer login sees only their cameras; live plays via tokened HLS; RTSP URL never leaves
  the backend for customers (no `private_rtsp_url` in any customer payload).
- Suspended subscriber camera: stream URL/token requests → 402; in-flight HLS dies ≤30s.
- Top-up (manual or webhook) credits wallet exactly once and auto-resumes the camera.
- Daily charges deduct exactly once per local day per subscription across restarts.
- Existing public hub, admin pages, viewer tracking, recording, playback tokens keep working
  (full vitest suites stay green).
