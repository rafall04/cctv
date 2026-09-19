---
name: ui
description: RAF NET CCTV frontend UI rules — the semantic design-token system, status-dot semantics, and mobile-viewport hard rules for THIS project. Use for ANY frontend/UI work in this repo (React components, pages, styling, layout). Overrides generic UI skills — do NOT reach for shadcn/Radix or raw color ramps here.
---

# UI — RAF NET CCTV design system

This project's UI has its own semantic token system and hard-earned rules. **The canonical
reference is `docs/frontend-guide.md`** — this file is the trigger + quick reference; read the
guide for depth before non-trivial UI work.

## Do NOT use (conflicts with this project)

- **No shadcn/ui, Radix, or component libraries** — plain Tailwind + custom tokens only.
- **No `dark-*` / `light-*` classes** — deprecated legacy ramps, kept only for old code.
- **No raw `gray-*`/`slate-*`/color ramps** in new work — use roles below.
- **No brand gradients or colored drop shadows** (`shadow-primary/30`) — flat `bg-primary`.
- **No bare `z-[number]`** — layering is a named scale, not a bidding war.
- **No internal jargon on public surfaces** — no `TUNNEL`, codec names ("H.264"), transport
  details. Codec shows only as a warning icon when the browser may genuinely fail to play.

## Semantic tokens (defined in `frontend/src/index.css`, mapped in `tailwind.config.js`)

| Role | Classes | Use for |
|---|---|---|
| Surfaces | `bg-surface-sunken` → `bg-surface` → `bg-surface-raised` → `bg-surface-overlay` | page → card → hover → popover |
| Edges | `border-edge`, `border-edge-strong` | the only two border weights |
| Text | `text-content`, `text-content-muted`, `text-content-subtle` | three text weights, no more |
| Status | `status-live` `status-warn` `status-fault` `status-idle` | **meaning, never decoration** |
| Radius | `rounded-control` (inputs/buttons) · `rounded-card` (cards) · `rounded-full` (true pills) | the whole scale |
| Elevation | `shadow-e1`, `shadow-e2` | two steps; dark mode depth = surface step + edge, not shadow |
| Layering | `z-raised` `z-sticky` `z-dock` `z-scrim` `z-shell` `z-map-chrome` `z-fab` `z-modal` `z-toast` `z-popup` `z-dialog` | ascending tiers; Leaflet paints at 1000 so map chrome must clear it |
| Text size | `text-xs` meta · `text-sm` body · `text-base` section title · `text-xl` page title · `text-2xl`/`3xl` headline metric | five steps, nothing below `text-xs` |

- `--primary-color` is a **runtime CSS var** (admin branding overrides) — never fold into tokens.
- Numbers that update in place get `tabular-nums`.

## Status semantics (anti-"AI slop")

- One status = **one dot**; a text label appears **only when the state is abnormal**.
- **Red = broken, only.** Live is `status-live` (green). REC may stay red but always with label.
- A dot is never the sole carrier of meaning — pair with `sr-only` text.
- A badge on ~100% of items is decoration — gate it to distinguishing states.
- Counts must say **what they count** ("317 online di peta" vs landing counts all).
- One ranked discovery surface on landing (`LandingDiscoveryStrip`) — don't recreate
  `LandingSmartFeed`.
- Color mapping lives in the presenting component, never inside a data util.

## Mobile viewport hard rules (each earned by a production bug)

- Keep `minimum-scale=1.0` in viewport meta (WebView zoom-fitting); never `maximum-scale`/
  `user-scalable=no`.
- Never size `position: fixed` with `100vw` — use insets (`left-4 right-4`).
- `html`/`body` `overflow-x: clip` — **never `hidden`** (kills `position: sticky`).
- `iframe/embed/object/canvas` stay clamped `max-width: 100%` (ad iframes).
- Flex rows of controls: `min-w-0` + `truncate` (Android font-scaling).
- Floating map chrome: solid `bg-surface` (no translucency over imagery), no hover-lift over
  draggable map.
- **Form controls `text-base sm:text-sm`, never bare `text-sm`** — iOS Safari zooms on <16px.
- **Touch targets ≥40px on narrow screens** — `min-h-[40px] sm:min-h-0`.
- Drag-handle hit-testing in screen px via `getBoundingClientRect()`, not frame fractions.
- Round handles: HTML element with % `left`/`top` + fixed px size — not SVG `<circle>` in a
  `preserveAspectRatio="none"` viewBox.

## React rules (frontend-guide.md has the full set)

- ALL hooks BEFORE any conditional return (React Error #310).
- Functional components + hooks; named exports for pages, default for reusable.
- Forms via `useFormValidation`; admin CRUD via `useCRUD(endpoint)`.
- Wrap risky trees in `ErrorBoundary`.

## Verify before done

`cd frontend && npm test && npm run build && npm run lint`. Public-layout changes additionally:
`npm run test:e2e` + verify once on a real Android phone via Telegram in-app browser with ads
loading (desktop engines can't reproduce WebView zoom-fitting — the 2026-07 incident).
