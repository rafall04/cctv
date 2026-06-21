# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The **canonical rulebook is [AGENTS.md](AGENTS.md)** — it is imported below so Claude Code loads it
automatically every session. Keep all coding rules/conventions in AGENTS.md (single source of truth);
this file stays thin on purpose.

@AGENTS.md

## Reference docs — read on demand (intentionally NOT auto-loaded, to keep context lean)

- **[SYSTEM_MAP.md](SYSTEM_MAP.md)** — navigation & architecture map: entry points, critical runtime
  flows, data/index notes, verification commands, stabilization priorities, and the current
  **Known Rule Deviations** list. Start here for "where does X live / how does flow Y work".
- **[docs/frontend-guide.md](docs/frontend-guide.md)** — React conventions: structure, hooks/race-condition
  rules, view-mode/URL-param/share-link patterns, frontend perf. Read when doing frontend work.
- **[docs/billing-rental.md](docs/billing-rental.md)** — subscriber rental + prepaid billing + payment
  gateways + plans + registration approval + playback scope. Read when touching billing/customer cameras.
- **[README.md](README.md)** — deployment, env-var setup, operational runbook (PM2 / Nginx / MediaMTX).
- **[SECURITY.md](SECURITY.md)** — security policy & posture.
- **[INSTALLATION_SECURITY.md](INSTALLATION_SECURITY.md)** — installer hardening (interactive install, generated secrets).
- **[MIGRATION_GUIDE.md](MIGRATION_GUIDE.md)** — running DB migrations safely on existing data. Read before
  `npm run migrate` on a populated DB (see the production data-safety rules in AGENTS.md).

## Known rule deviations

The code does not yet fully conform to the rules in AGENTS.md. Before relying on a rule, check the
**"Known Rule Deviations"** section of [SYSTEM_MAP.md](SYSTEM_MAP.md) for the current, precise list
(with `file:line`) so you don't propagate or depend on a known gap.
