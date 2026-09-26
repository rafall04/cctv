---
name: ops
description: Deployment and operations for RAF NET CCTV — PM2 processes, nginx, MediaMTX, release channels, safe-deploy, DB migrations on a populated database. Use when deploying, restarting services, changing env vars, running migrations on prod, or debugging a live box.
---

# Ops — deploy & production operations

Canonical references: `README.md` (runbook), `deployment/` (scripts), `MIGRATION_GUIDE.md`,
`docs/spek-server.md`, `SYSTEM_MAP.md`. This file is the trigger + safety checklist.

## Process map (pm2)

- `rafnet-cctv-backend` — Fastify on `localhost:3000` (cluster). Restart after backend changes.
- `rafnet-cctv-recorder` — FFmpeg segment recorder. **Safe to restart**: re-adopts running
  FFmpeg via `recording_process_state` (verified on prod, no segment interrupted).
- `mediamtx` — RTSP→HLS. All ports must bind **127.0.0.1** (8554/8888/8889/9997/1935);
  UFW explicitly DENYs them externally. Never expose.
- Nginx serves the SPA + proxies `/api`, `/hls`, `/api/thumbnails`, `/api/recordings` to :3000.

## Deploy flow (release channels)

- `deployment/release-channels.json` is THE control point: `canary`/`stable` point at release
  tags; `safe-deploy.sh` reads it from `origin/main`. Promotion = commit to that file.
- Flow: tag release → point `canary` at it + push → canary deploys + verify → point `stable`.
- `deployment/safe-deploy.sh` — the deploy script; preserves existing security flags, ensures
  secrets (JWT/API_KEY/CSRF), warns on placeholder `VITE_API_KEY`.

## Database safety (learned from a real incident — a customer row was lost)

- **NEVER mutate prod `data/cctv.db` to verify** — verify via API with a throwaway account, a
  rolled-back transaction, or a DB copy.
- **NEVER `INSERT OR REPLACE`** ad-hoc rows — silently deletes conflicting real rows.
- **Always back up `cctv.db` before any manual DB op.**
- `npm run migrate` BEFORE restarting backend after schema changes; read `MIGRATION_GUIDE.md`
  on a populated DB.
- `telegram_archive_uploads` must NEVER be pruned — it is the index into the Telegram archive
  (local retention 4h; older footage reached via `file_id`).

## Logging discipline (pm2 stderr/stdout split is the only triage tool)

- stderr = a human must look at it. Expected conditions (3rd-party camera down, deliberate
  backoff) → `console.log`. Transitions, not steady state. One line per cycle, not per item.

## Env / secrets

- All config via env vars. `backend/.env` must be `chmod 600` on prod.
- Backend should bind `127.0.0.1` (`HOST` env) — nginx proxies via localhost.
- MediaMTX API (9997) + RTSP (8554) loopback-only; nginx returns 403 on mediamtx hostnames.

## Verify after deploy

- `pm2 list` all online; `pm2 logs --err` quiet (stderr = real errors only).
- `curl /health` on the box; spot-check `/api/cameras/active` publicly.
- Run the `security-audit` skill probe matrix after access-control changes.

## Known CPU baseline (audited 2026-09-27 — mediamtx ~46–56% is NOT a bug)

The prod box is **multi-tenant**: six `motion-ai` Docker containers (motion-rt02, tijar1/2,
cam, pertigaan, cctv-timur-kali-apur) each pull `rtsp://localhost:8554/<path>` from our
mediamtx at full camera fps but only analyse `TARGET_FPS=5`. MediaMTX then spends ~50%+ of
one core copying frames into readers that can't keep up — visible as `WAR [RTSP] reader is
too slow, discarding N frames` spam. That is **real consumer load, not a hot loop**: only
~6 of ~416 paths are `ready` (on-demand remux works correctly). Diagnose with
`curl localhost:9997/v3/paths/list` (ready count), `ss -tnp | grep :8554` (reader pids),
`docker stats` (container CPU). Do NOT "fix" by restarting mediamtx — readers reconnect and
the load returns. Structural fix belongs to the motion-ai project (read camera sub-streams
or a lower-fps source). MediaMTX log noise on the box is dominated by this discard spam —
filter it mentally when scanning pm2 logs.
