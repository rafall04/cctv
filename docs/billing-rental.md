<!--
Purpose: Subscriber rental + prepaid billing + playback-scope operational rules, extracted from AGENTS.md to keep the auto-loaded rulebook lean.
Caller: Read on demand when touching billing, subscriber/customer cameras, payment gateways, account plans, registration approval, or playback access scope.
Deps: AGENTS.md (critical invariants stay there), SYSTEM_MAP.md (runtime flows + service map).
-->

# Billing, Rental & Playback Workflow — read on demand

> The **non-negotiable invariants** (camera-class public-surface filter, money = INTEGER rupiah,
> customer denied-by-default, live-only subscriber product) are kept inline in
> [AGENTS.md → Critical Invariants](../AGENTS.md). This file holds the detailed operational rules you
> only need while building/fixing billing, subscriber cameras, payments, or playback scope.
> For service-level flows see [SYSTEM_MAP.md → Critical Runtime Flows](../SYSTEM_MAP.md).

## Subscriber Rental / Billing Workflow

- Camera classes: `community` (public hub, default), `owner_private`, `subscriber` (rented, live-only).
  Non-community cameras must NEVER appear on any public surface (landing/map/stream list/area pages/
  trending/discovery/public playback/thumbnails) — all public queries filter `camera_class = 'community'`
  and `cameraAccessService.canViewLive` gates per-camera endpoints (`/api/stream/:id`, `/hls/*`, proxies).
- Role `customer` logs in at the shared login and lands on `/my` (portal: Kamera Saya + Saldo & Tagihan).
  Customers are denied-by-default on every other auth-required endpoint (`customerAccessPolicy`).
- Billing is prepaid: wallet balance, daily prorated charge (`monthly_price/30`, local date, idempotent by
  `charge:{subscriptionId}:{date}` unique reference), suspend on empty balance (streams 402 within ~30s),
  auto-resume + charge on top-up. Money columns are INTEGER rupiah only — never float.
- Admin manages everything at `/admin/billing` (assign camera→customer, harga, suspend/resume/cancel,
  manual top-up, mark-paid, plan catalog, registration settings). Gateway drivers: `manual` (default),
  `midtrans` (webhook signature-verified), or `ipaymu` (credentials from admin/settings;
  callbacks carry no signature so the webhook NEVER trusts the body — it re-queries the iPaymu API, and
  customer status polls do the same re-check throttled). Webhooks under `/api/billing/webhook/*` are
  exempt from CSRF/API-key validation.
- Gateway config is admin-editable (NO .env needed): `paymentSettingsService` resolves every value
  DB(settings) -> env -> default, so old `.env` deployments keep working until an admin overrides. The
  `/admin/billing` -> Gateway Pembayaran tab sets active gateway, iPaymu VA/API key + sandbox/production,
  Midtrans server key, public base URL, and the curated enabled payment methods/banks (`ipaymu_methods`:
  QRIS/VA-bank/cstore; admin toggles + can add custom `method:channel`). Secrets are write-only —
  `getAdminView()` returns only a `*_set` flag + masked hint, never the raw key. Customer top-up shows
  only enabled methods (`GET /api/customer/payment-options`), rendering QR / VA number / payment code.
- Account plans (paket): `billing_plans` sets price_per_camera + max_cameras (+ trial via is_trial/
  trial_days). Customers self-switch at `/my/paket` (repricing all their subscriptions; trial once per
  account — `users.trial_used`); active trial days are charge-free, expired trial suspends all cameras
  until a paid plan is chosen.
- Self-service: customers add/edit/delete their own cameras at `/my` within the plan's max_cameras;
  customer RTSP URLs pass `utils/rtspUrlPolicy.js` (rtsp/rtsps only; loopback/link-local/multicast and
  `BILLING_RTSP_BLOCKED_HOSTS` blocked; RFC1918 allowed — ISP reality). Self-registration at `/daftar`
  (`POST /api/auth/register`, unique phone, admin toggle + default plan in `/admin/billing` Paket tab).
- Registration approval: self-registered customers start `users.account_status='pending'` and CANNOT log
  in (login → 403 `reason: pending_approval`) until an admin approves them in `/admin/billing` →
  Persetujuan tab. The plan/trial clock starts ON APPROVAL (deferred at signup) so the trial isn't
  consumed while waiting. `account_status` defaults to `'approved'` — existing and admin-created users
  are never locked out; declined accounts are `'rejected'` (login → 403 `reason: registration_rejected`).
- Subscriber product is live-only: no public playback, no playback-token access, recordings stay staff-only.

## Playback / Admin Workflow

- Public playback route: `/playback` with `accessScope='public_preview'`
- Admin full playback route: `/admin/playback` (protected)
- Admin playback analytics route: `/admin/playback-analytics` (protected)
- Public playback API uses `/api/recordings/:cameraId/segments`, `/stream/:filename`, and `/playlist.m3u8`
- Playback viewer tracking is separate from live viewer tracking and uses `/api/playback-viewer/*`

## Playback Tracking Pattern

- Start playback viewer sessions only after real playback begins (`playing` or equivalent progress), not when the page opens
- Keep playback tracking separate from live tracking:
  - live: `viewer_sessions`, `/api/viewer/*`
  - playback: `playback_viewer_sessions`, `/api/playback-viewer/*`
- When changing camera or segment in playback, stop the old playback session before starting a new one
- For public/admin playback differences, pass the correct `accessScope` (`public_preview` or `admin_full`) through frontend and backend calls
