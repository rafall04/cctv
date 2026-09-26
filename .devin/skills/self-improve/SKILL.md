---
name: self-improve
description: Autonomous improvement loop for RAF NET CCTV — pick the highest-value item, implement it with full gates, deploy, verify live, log what changed. Use when the user says "improve", "self update", "lanjutkan improvement", "update fitur otomatis", or asks to continue unattended improvement work.
---

# Self-Improve — autonomous improvement loop

The user wants continuous, unsupervised iteration on this codebase. Run ONE item per loop
iteration, completely: candidate → implement → gates → deploy → verify → log. Then either
stop and report, or continue to the next item if the user asked for a run ("/improve again",
"lanjut").

## State file: `.devin/backlog.md`

Persistent scored candidate list — survives across sessions. Refresh it at the START of every
run; pick from the top; update statuses when done. Never drop user-added items.

## Loop

### 1. Gather candidates (refresh backlog)

Check each source, cheap checks first:

- `SYSTEM_MAP.md` → "Known Rule Deviations" list (items meant to be fixed)
- `.devin/backlog.md` → carry-over items with notes
- `npx skills update --dry-run` (or `--check`) → stale third-party skills
- `rg -n "TODO|FIXME|HACK|XXX" backend/src frontend/src backend/controllers backend/services`
- Budget/perf: `cd frontend && npm run build` → compare chunk sizes vs last run; the
  guardrails test (`npm test -- guardrails`) enforces file-size ratchet — shrinking a frozen
  file is always a candidate
- Ops: `pm2 list` CPU% (mediamtx ~46% is a standing open question), `pm2 describe
  rafnet-cctv-backend`, error-log rate (`tail -200` on the pm2 logs), `cctv.db` size trend
- Test gaps: modules with no `*.test.*` neighbour in hot paths

### 2. Score & pick ONE

Score = **user impact** (viewer-visible > admin > internal) × **risk** (invert: low risk
wins) − **cost** (file count, schema/UI surface). Prefer a small certain win over a large
uncertain one. If the top item is ambiguous, ask the user once — never guess on scope.

### 3. Implement (existing rules apply unchanged)

- TDD where the repo has test infra (`npm test -- <file>` iterating; full suite as gate).
- Follow `AGENTS.md` invariants and the relevant deep-dive guide BEFORE touching the area.
- Keep the diff reviewable — one concern per commit, `Add:`/`Fix:`/`Refactor:` message.

### 4. Gates (all must pass)

- Backend: `cd backend && npm run migrate && npm test`
- Frontend: `cd frontend && npm test && npm run build && npm run lint`
- Public-layout change: `npm run test:e2e` (real-browser overflow smoke)

### 5. Deploy (only when the item should ship)

- Tag `vX.Y.Z` → bump `deployment/release-channels.json` → push → `safe-deploy.sh` on the
  box → verify `/health`, `buildId`, stability gate. Never deploy without gates green.
- ⚠️ Channel manifest gotcha (hit 2026-09-27): the script reads
  `manifest.channels[DEPLOY_CHANNEL]` FIRST, top-level keys only as fallback. Edit the
  nested `channels` object — adding top-level `"stable"/"canary"` keys is silently ignored
  and produces a no-op deploy of the previous tag. After deploy, confirm
  `git describe --tags` on the box equals the intended tag, not just that it completed.
- `safe-deploy.sh` prompts `Proceed? [y/N]` on stdin — run it detached with the answer
  piped in and output to a log (`setsid bash -c 'echo y | bash ... > /tmp/log 2>&1'`),
  never inline over SSH: a >5min deploy outlives the channel's read timeout.

### 6. Log & self-update

- Update `.devin/backlog.md`: mark done, note any new candidate found while working.
- If the work taught a durable project fact (a gotcha, an env quirk, a measured baseline),
  append it to the relevant `.devin/skills/*/SKILL.md` or `SYSTEM_MAP.md` — that IS the
  "self update" half of this skill.
- Report to the user in one short block: what shipped, evidence, what's next in backlog.

## Hard guardrails — ask the user before touching

These cannot run unattended; queue them in the backlog as `needs-human` and stop:

- Billing/money paths (`billingService`, voucher, payment gateways, plan/subscription logic)
- Privacy boundary changes (public/private camera visibility, archive scope, tokens)
- Anything that mutates prod `data/cctv.db` or security-flag env values
- New third-party skills/deps with <100 installs or unknown provenance
- Deleting files/routes/endpoints; schema drops; auth policy edits

## Stop conditions

- User says stop / question unresolved after one focused attempt to clarify
- Backlog empty or every remaining item is `needs-human`
- Gates fail and the fix is non-obvious → revert the change, log it, stop (do NOT stack
  speculative fixes on a red gate)
