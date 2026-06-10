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
- **[README.md](README.md)** — deployment, env-var setup, operational runbook (PM2 / Nginx / MediaMTX).
- **[SECURITY.md](SECURITY.md)** — security policy & posture.

## Known rule deviations

The code does not yet fully conform to the rules in AGENTS.md. Before relying on a rule, check the
**"Known Rule Deviations"** section of [SYSTEM_MAP.md](SYSTEM_MAP.md) for the current, precise list
(with `file:line`) so you don't propagate or depend on a known gap.
