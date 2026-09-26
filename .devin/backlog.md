# Improvement backlog — scored, persistent

Read by `.devin/skills/self-improve`. Refreshed at the start of every loop run.
Status: `open` | `needs-human` | `done`. Score = impact × (1/risk) − cost.

| # | Item | Source | Score hint | Status |
|---|---|---|---|---|
| 1 | ~~Audit `rafnet-mediamtx` CPU~~ → done: beban sah dari 6 container `motion-ai` (box multi-tenant); bukan bug. Detail di ops SKILL.md "Known CPU baseline" | ops / pm2 | resolved-by-audit | done |
| 2 | Verifikasi HP asli (Telegram WebView) untuk fix legend map z-raised — gate wajib layout publik | AGENTS.md rule | user action required | needs-human |
| 3 | `npx skills update` mingguan — review diff lalu merge (jangan auto-merge tanpa baca) | skills-lock.json | tiny, safe as PR | open |
| 4 | Ci workflow untuk item 3 (PR otomatis, bukan auto-merge) | CI | small, contained | open |
| 5 | EmptyState/Skeleton/authService ~35KB src masih di App chunk — kandidat lazy berikutnya jika masih butuh TBT | bundle map | medium, perlu cek callsite | open |
| 6 | `diagnosing-superpowers`-style: petakan request `other`-initiator SWR di docs agar tidak dikejar ulang | sesi 2026-09-26 | doc-only, nol risiko | open |
| 7 | Konsumen lain `backgroundRefreshError`? — stats board/toolbar sengaja dibiarkan (dot per-kamera ≠ freshness claim); audit ulang jika ada permukaan status baru | sesi 2026-09-27 | doc/audit-only | open |

## Done

| Item | Tanggal | Bukti |
|---|---|---|
| OG/Twitter share preview per kamera & area — SSI `/api/public/og-meta?path=$uri&camera=$arg_camera` di `<head>` sebelum default statis (first-wins scrapers); lookup hanya di list publik → privat tak mungkin leak; empty-safe 200 | 2026-09-27 | 8 test baru `publicOgMeta.test.js`, 2969 backend hijau, lint bersih |
| Mode Monitor `/monitor` — TV-wall pos ronda auto-cycle publik | 2026-09-27 | 8 test, 2083 vitest + 246 e2e, chunk 3.2KB gz; live-verified 800 kamera playable, rotasi presisi 10s, HLS memutar, console bersih. Hotfix v1.4.153: list publik tanpa `streams` → filter `getStreamCapabilities` + resolve per slot (invariant di `pages/.module_map.md`) |
| Mode Monitor v2 — per-area + double-buffer channel-surf | 2026-09-27 | v1.4.154: `?area=<slug>` + picker + dwell dari status `playing` + resolver-per-slot (16 test, 2090 vitest, 246 e2e). v1.4.155: hidden slot memutar kamera berikutnya penuh — rotasi jadi swap visibilitas; live DS DANDER: mayoritas slot 0s "Memuat siaran" (dulu 6–10s tiap slot). Deploy note: health-gate 40s bisa kalah dari boot berat di box multi-tenant — cek `/health` manual sebelum rollback |
| `backgroundRefreshError` dead-signal → chip `Menunda`/warn di navbar+simple | 2026-09-27 | 2 test baru, 2075 vitest + 246 e2e hijau |
| Legenda map menimpa dock mobile + dedupe API tick | 2026-09-26 | v1.4.149 live, rect terukur |
| Console production bersih | 2026-09-26 | v1.4.147–148, list_console_messages 1 info Chrome |
| LCP boot img (SSI + mini thumb + rAF mount) | 2026-09-26 | v1.4.143–146, LCP 5.8s→0.6–1.2s |
| Fetcher kecil disatukan + App chunk split | 2026-09-26 | v1.4.150, App 75.0→70.3KB gz |
