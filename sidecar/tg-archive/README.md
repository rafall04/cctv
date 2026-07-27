# tg-archive — CCTV recordings → Telegram groups

Uploads every finalized 10-minute recording segment to Telegram, **routed per camera
or per area** so one group never mixes sources. Runs through a **self-hosted local Bot
API server**, which raises the per-file limit from the cloud Bot API's **50 MB** to
**2000 MB**. No transcoding — original files are sent as-is.

## Why a local Bot API server

Measured on this box (2026-07-26, 11 recording cameras):

| | |
|---|---|
| Segment size, 10 min | 17 MB – 226 MB (avg ~104 MB) |
| Cloud Bot API limit | 50 MB → only 2 of 11 cameras would fit |
| Local Bot API limit | 2000 MB → all fit, zero CPU |
| Volume | 899 files/day, 91.1 GB/day |
| Sustained egress **needed** (all 11 cameras) | ~9.1 Mbps — a demand figure, not a limit |
| Real upload throughput to Telegram | **median 43.7, peak 60.4 Mbps** (103 live uploads) |
| Duty cycle at 11 cameras | 648 MB per 10-min window ÷ 43.7 Mbps ≈ **2 min of every 10** |

**Do not size this from a generic speed test.** On this box `speed.cloudflare.com` reports
4.5 Mbps on one stream and 30 Mbps across four, while single-stream uploads to Telegram
sustain 43–60 Mbps. The Cloudflare path is the bottleneck, not the uplink. The only
trustworthy number is the `Mbps` field the uploader logs for each real segment:

```bash
journalctl -u tg-archive --since "24 hours ago" | grep -oE '[0-9.]+ Mbps'
```

Transcoding to fit 50 MB was measured at 0.78 CPU cores per camera = 8.6 cores for the
fleet, on an 8-core box already running at load 6. That is why we raise the limit
instead of shrinking the files.

## Architecture

```
recordingSegmentFinalizer (app)  ──atomic rename──►  recordings/cameraN/*.mp4
                                                       │
                                        row in recording_segments (app DB)
                                                       │  polled READ-ONLY
                                                       ▼
                                              uploader.py (systemd)
                                                       │  routes.json → target groups
                                                       │  file:// reference
                                                       ▼
                                    tg-archive-api container (127.0.0.1:8092)
                                                       │
                                                       ▼
                                    Telegram group(s) — per camera / per area
```

- The app DB is opened with `mode=ro` — this sidecar **can never write to it**.
- Upload state lives in `/opt/tg-archive/state.db`, entirely separate.
- The container mounts `recordings/` **read-only at the same absolute path**, so
  `--local` mode reads the file straight off disk (no 200 MB multipart copy).
- Port 8092 binds to **127.0.0.1 only** — the bot token surface is never on the LAN.

> **Gotcha:** in `--local` mode the `document` field must be a **`file://` URI**. A bare
> absolute path is parsed as an HTTP URL and rejected with
> `invalid file HTTP URL specified: URL host is empty`.

## Routing (routes.json)

Which group each camera lands in. Edited live — the uploader re-reads the file on
change, **no restart needed**.

```json
{"routes": [
  {"id":"selatan-ahass","enabled":true,"scope":"camera","cameraId":1441,
   "chatId":"-5510674082","label":"Arsip Selatan AHASS"},
  {"id":"dander","enabled":true,"scope":"area","areaId":2,
   "chatId":"-100...","label":"Arsip DS Dander"}
]}
```

- `scope`: `camera` (most specific) → `area` → `all`.
- The most specific matching group performs the real upload. Any **additional**
  matching group receives a `copyMessage`, which reuses the already-uploaded file —
  a second group therefore costs **zero extra bandwidth**.
- A camera matching no route is never sent (status `no_route`). That is the on/off
  switch: add a route to enable a camera, remove it to stop.
- Areas on this deployment: **2 = DS DANDER** (cam 1, 5, 9, 1168, 1169, 1170, 1435, 1441),
  **3 = DS TANJUNGHARJO** (cam 2, 7, 8).

Check what is actually wired before trusting it:

```bash
/opt/tg-archive/uploader.py --routes
```

## First-time setup

1. Get `api_id` / `api_hash` from <https://my.telegram.org> → *API development tools*.
2. Create a **dedicated** bot with @BotFather. Do **not** reuse `@cctv_rafnet_bot` —
   a bot can only be attached to one Bot API server at a time, and that one runs the
   alerts/commands on the cloud API.
3. Create the group, add the bot, and let it post.
4. Fill `/opt/tg-archive/.env` (chmod 600).
5. Log the new bot out of the cloud API so it can attach to the local server:
   ```
   curl -s "https://api.telegram.org/bot<TOKEN>/logOut"
   ```
6. Start the API container and find the chat id:
   ```
   docker compose -f /opt/tg-archive/docker-compose.yml up -d
   # send  /start@<botusername>  in the group, then:
   /opt/tg-archive/uploader.py --discover-chat
   ```
7. Add the group to `routes.json`, then confirm the wiring and dry-run:
   ```
   /opt/tg-archive/uploader.py --routes
   DRY_RUN=1 /opt/tg-archive/uploader.py
   ```
8. Enable:
   ```
   systemctl enable --now tg-archive
   ```

### Adding a camera or a whole area later

Edit `routes.json` only — no restart, no redeploy:

```bash
nano /opt/tg-archive/routes.json
/opt/tg-archive/uploader.py --routes    # confirm before walking away
```

## Operating

```bash
systemctl status tg-archive
journalctl -u tg-archive -f
/opt/tg-archive/uploader.py --status         # counts + GB per status
docker logs --tail 50 tg-archive-api
```

**Rolling back completely** — nothing in the app is modified, so:
```bash
systemctl disable --now tg-archive
docker compose -f /opt/tg-archive/docker-compose.yml down -v
rm -rf /opt/tg-archive
```

## Knobs that matter

- **`routes.json`** — the real on/off switch and the coverage control. Start with a
  few cameras; all 11 is ~9 Mbps sustained.
- `MAX_AVG_MBPS` — long-run average cap, enforced by sleeping **between** files. The transfer
  itself always runs at line rate, so this does not soften a burst; it only bounds a backfill.
  Must sit above the observed per-file rate or it throttles every single upload — at 14 against a
  41.5 Mbps transfer rate it slept 66% of the time and delayed archives for no benefit.
- `TG_CHAT_ID` — optional fallback group used only when a segment matches no route.
  Leave it empty to make `routes.json` the sole authority.
- `BACKFILL=0` — on first run the watermark jumps to the newest segment. Setting
  `BACKFILL=1` would try to upload every retained segment (~911 rows / ~91 GB today). Don't.

## Known limits

- Telegram group storage is not a backup guarantee; treat this as a convenience
  mirror, not the archive of record.
- A group upgraded to a supergroup changes its chat id. That is handled — the new id
  is recorded and the send retried — but `routes.json` still shows the old one.
- Segments over `MAX_FILE_MB` are skipped and logged as `too_big`, not retried.
- A permanently failing segment is recorded as `failed` and skipped so it cannot
  wedge the queue behind it.
