---
name: billing
description: Billing/rental system invariants for RAF NET CCTV — subscriptions, vouchers, customer/owner access scope, money handling, sponsor/affiliate. Use when touching billing, voucher, customer, subscription, or payment-adjacent code.
---

# Billing — invariants that must hold

Canonical references: `docs/billing-rental.md`, `backend/routes/billingRoutes.js`,
`backend/routes/voucherRoutes.js`, `backend/services/billingService.js`, `webhookService.js`.

## Access model (do not soften)

- Subscriber cameras are **private to owner + admin only** — never public.
- Subscribers may watch other cameras under normal rules; their own footage never becomes
  public even while subscribed.
- Customer portal is **denied-by-default**: no customer/voucher/admin linkage → not eligible.
- A suspended subscription removes public visibility (`is_public=1` AND `suspended` → hidden).
  Verified empirically on prod (cam 1439).

## Money handling

- Money = integer (rupiah, no decimals) in DB. Format at the edge only.
- Billing/rental values are enforced server-side, not trusted from client input.

## Mutations

- Cache invalidation after billing/voucher mutations that change camera visibility or
  customer state — the public camera list and `/api/cameras/active` are cached.
- Webhook handlers (`/api/billing/webhook`, `/api/voucher/webhook`) are signature-verified
  and public-prefixed in the API-key whitelist — never add auth that breaks the provider.

## API-key whitelist interaction

Billing/voucher webhook prefixes are public at the API-key layer by design — the provider
cannot hold a key. Route-level signature verification is the real gate. Do not "fix" this.
