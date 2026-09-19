---
name: security-audit
description: Verify no private data leaks on the live deployment — private/subscriber streams, recordings, thumbnails, credentials, RTSP URLs, admin endpoints. Use when asked to "cek security", "audit leak", "pastikan tidak ada yang leak", "security check production", or before a release that touches access control.
---

# Security Audit — RAF NET CCTV Hub

Repeatable read-only audit of the live deployment (`cctv.raf.my.id` + prod box). Verifies the
Critical Invariants in AGENTS.md hold on the real public surface — not just in code.

**Golden rule: READ-ONLY on production.** No DB mutation, no config change, no writes. The prod
DB safety rules in AGENTS.md apply in full. SSH credentials are NOT stored here — ask the user
for them at audit time (they were provided interactively in past sessions).

## When to run

- After any change to `cameraAccessService`, `cameraVisibility`, `hlsProxyRoutes`,
  `streamService`, `publicArchiveAccessService`, or auth middleware
- Before tagging a release
- On request ("cek security")

## Step 0 — establish access

- Public web: probe `https://cctv.raf.my.id` directly (no auth — that IS the test).
- SSH: `plink -ssh -P <port> -pw <pass> root@<host> "<cmd>"` (PuTTY's plink handles password
  auth non-interactively; `echo y |` on first connect to accept the host key, then `-batch`).
  Read-only commands only: `sqlite3` SELECTs, `ss -tlnp`, `ufw status`, `git log`, `cat`/`grep`.

## Step 1 — get the ground truth from prod DB (read-only)

```sql
SELECT id, name, camera_class, is_public, billing_status, enabled, stream_key, thumbnail_path
FROM cameras WHERE camera_class != 'community' OR is_public = 0;
SELECT camera_class, is_public, billing_status, COUNT(*) FROM cameras
GROUP BY camera_class, is_public, billing_status;
```

Collect the IDs of every `owner_private` camera and every `subscriber` camera (active or
suspended). These are the **must-be-invisible** set. Also grab one `community` camera ID +
`stream_key` as the positive control.

## Step 2 — probe matrix (anonymous, from outside)

Run every row for EVERY private ID. Expected results are the invariant:

| Probe | Private cam | Community cam |
|---|---|---|
| `GET /api/cameras/active` | id absent | id present |
| `GET /api/stream/{id}` | **404** "not found" (never confirms existence) | 200 |
| `GET /api/stream/{id}/token` | 404 | 200 (community is public) |
| `GET /api/stream/{id}/live-token` | 401/404 | 401 without playback token |
| `GET /hls/{stream_key}/index.m3u8` | **403** — even with spoofed `Referer` | 403 without Referer; 200 same-origin |
| `GET /hls/camera{id}/index.m3u8` (legacy path) | 403 | gated |
| `GET /api/thumbnails/{id}.jpg` (predictable path) | **403** | 200 |
| `GET /api/recordings/{id}/segments` | **403** | 200 (public archive product) |
| `GET /api/recordings/{id}/stream/{file}` | 403 | — |
| `GET /api/recordings/{id}/playlist.m3u8` | 403 | — |
| `GET /api/recordings/archive/{segId}/stream` | 404 without token | — |
| `GET /api/playback-archive/{segId}/stream` | 404 without token | — |
| `POST /api/viewer/runtime-signal` `{cameraId}` | `ignored:true` (no session) | — |
| `GET /api/public/discovery`, `/trending-cameras`, `/areas/public` | id absent | may appear |
| `GET /api/public/cameras/{id}/reaction` | 404 | 200/404 |
| `GET /api/admin/debug/camera-health` (all roles) | 401 anonymous | — |

Any private camera returning 200 on a content endpoint, or appearing in any public list, is a
**critical leak** — stop and fix before anything else.

## Step 3 — credential/PII scan on public payloads

Fetch `/api/cameras/active` and every other public JSON. Regex-scan the raw bodies for:

- `rtsp://`, `rtmp://`, `onvif` — must never appear
- `[a-z]+://[^/?#\s"']+@` — userinfo credentials in ANY URL — must never appear
- `password|passwd|secret|apikey|api_key` — must never appear
- `email|phone|user_id|owner|username|whatsapp` — PII fields — must never appear
- `token=` — expected ONLY inside `external_*_url` of community cameras pointing at third-party
  public sources (ZoneMinder JWTs, expiring, by-design for playback). Any other `token=` context
  is a finding.
- Known sensitive fields that must NOT ship: `private_rtsp_url`, `stream_key` is fine (gated
  upstream), `rtsp_url`, camera `username`/`password` columns.

## Step 4 — infra exposure (via SSH, read-only)

- `ss -tlnp` — MediaMTX 8554/8888/8889/9997/1935 must bind `127.0.0.1`; backend port should too
  (nginx proxies via localhost).
- `ufw status` — MediaMTX ports explicitly DENY; backend port should not be ALLOWed.
- nginx site config — deny rules for `.env`, `.git`, `.db/.sql/.bak`, `node_modules`,
  `package.json`; `/webrtc/` policy; MediaMTX hostnames → `deny all`.
- `.env` file perms — expect `600`; `644` leaks secrets to other local users.
- Verify deployed `git log` vs `origin/main` — is prod behind on security fixes?
- Confirm gates empirically: private cam `/hls/<uuid>` 403, `runtime-signal` ignored without
  session — proves the deployed binary actually contains the fix, not just that source does.

## Reporting

Table of probe → expected → actual → PASS/FAIL. Separate real leaks (act now) from hardening
notes (UFW hygiene, file perms, dead advertisements, version drift). Never paste real
credentials or token values into the report — describe them.

## Reference: 2026-09-19 audit result

All gates PASSED on prod (`ffb04ce6`). 3 owner_private + 1 suspended-subscriber camera fully
invisible; ZoneMinder JWTs flagged as low-risk by-design; findings noted: backend bound
`0.0.0.0` w/ UFW allow (NAT not forwarding — no live exposure), `.env` 644, FTP/aaPanel open,
`/webrtc` dead advertisement (fixed in 5ad430d4+).
