# tg-archive — CCTV recordings → Telegram group

Uploads every finalized 10-minute recording segment to a Telegram group through a
**self-hosted local Bot API server**, which raises the per-file limit from the cloud
Bot API's **50 MB** to **2000 MB**. No transcoding — original files are sent as-is.

## Why a local Bot API server

Measured on this box (2026-07-26, 11 recording cameras):

| | |
|---|---|
| Segment size, 10 min | 17 MB – 226 MB (avg ~104 MB) |
| Cloud Bot API limit | 50 MB → only 2 of 11 cameras would fit |
| Local Bot API limit | 2000 MB → all fit, zero CPU |
| Volume | 899 files/day, 91.1 GB/day |
| Sustained egress needed | ~9.1 Mbps of a measured ~25.6 Mbps uplink |

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
                                                       │  local file path
                                                       ▼
                                    tg-archive-api container (127.0.0.1:8092)
                                                       │
                                                       ▼
                                              Telegram group
```

- The app DB is opened with `mode=ro` — this sidecar **can never write to it**.
- Upload state lives in `/opt/tg-archive/state.db`, entirely separate.
- The container mounts `recordings/` **read-only at the same absolute path**, so
  `--local` mode reads the file straight off disk (no 200 MB multipart copy).
- Port 8092 binds to **127.0.0.1 only** — the bot token surface is never on the LAN.

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
7. Put `TG_CHAT_ID` in `.env`, then dry-run before going live:
   ```
   DRY_RUN=1 /opt/tg-archive/uploader.py
   ```
8. Enable:
   ```
   systemctl enable --now tg-archive
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

- `CAMERA_IDS` — start with a subset. Empty means all 11 (~9 Mbps sustained).
- `MAX_AVG_MBPS` — average egress cap; the uploader sleeps between files to hold it.
  Lower this first if live streams start buffering.
- `BACKFILL=0` — on first run the watermark jumps to the newest segment. Setting
  `BACKFILL=1` would try to upload every retained segment (~911 rows / ~91 GB today). Don't.

## Known limits

- Telegram group storage is not a backup guarantee; treat this as a convenience
  mirror, not the archive of record.
- Segments over `MAX_FILE_MB` are skipped and logged as `too_big`, not retried.
- A permanently failing segment is recorded as `failed` and skipped so it cannot
  wedge the queue behind it.
