# Box-level config that lives OUTSIDE the app tree

These files are load-bearing but live at fixed OS paths on the production box, **not** under
`/var/www/rafnet-cctv`, so `git`/`safe-deploy` never sees them. They were invisible until a forward-risk
audit (2026-09-05) found them: a full box rebuild would silently drop each one. This directory is the
tracked **reference** — the box is still the source of truth for the running copy, but now there is a
committed baseline to restore from and diff against.

> ⚠️ Reference snapshots, not auto-deployed. `safe-deploy` does not copy these (they need root at OS
> paths and rarely change). After editing one on the box, update the copy here too, or the two drift —
> the same "two copies" trap that hid the tg-archive A-01 fix and the Ronda motion.py fixes.

## cleanup-ram-hls.sh → `/usr/local/bin/cleanup-ram-hls.sh`
Safety net that deletes HLS segments older than 10 min from the RAM disks (`/dev/shm/mediamtx-live`,
`/dev/shm/nginx-cache`) in case MediaMTX crashes and stops rotating them — without it, a crash slowly
fills `/dev/shm`. Wired via root crontab, every 5 minutes:

```cron
*/5 * * * * /usr/local/bin/cleanup-ram-hls.sh
```

Restore: `install -m 755 deployment/box-config/cleanup-ram-hls.sh /usr/local/bin/` then add the cron line.

## chrony.conf → `/etc/chrony/chrony.conf`
Makes the box the LAN **NTP server** the CCTV cameras sync their clocks against (see the NTP-server
memory: cameras drift, so their OSD timestamps and recording filenames depend on this). The load-bearing
lines are `local stratum 10` (serve time even when upstream is unreachable) and the `allow <subnet>`
lines for the camera subnets. Secrets are NOT here — `keyfile /etc/chrony/chrony.keys` is a separate
file (not tracked). Restore: copy over `/etc/chrony/chrony.conf`, then `systemctl restart chrony`.

## iptables NAT (no file — persisted via crontab `@reboot`)
The only hand-added NAT rule redirects syslog UDP 514 → 5514, re-applied on every boot from root crontab:

```cron
@reboot /usr/sbin/iptables -t nat -A PREROUTING -p udp --dport 514 -j REDIRECT --to-ports 5514
```

Everything else in `iptables -t nat` is Docker-managed (per-bridge `MASQUERADE`) and regenerates itself —
do NOT capture or restore those by hand.

## Not ours (shared box)
The box also runs unrelated crontab jobs (`/www/server/cron/*` = aaPanel; `/opt/undangan/...` = a separate
project). Leave them alone.
