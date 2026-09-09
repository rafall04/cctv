<!--
Purpose: Rancangan matang (design roadmap) untuk memperluas fitur Siaran Audio menjadi sistem PA
         jaringan "desa digital": deteksi kapabilitas kamera otomatis, endpoint STB speaker-node,
         target ter-scope lokal, impor audio dari URL/YouTube, dan penjadwalan fleksibel.
Caller: Acuan implementasi bertahap. Bukan kode; tidak di-deploy.
Status: DESIGN — belum diimplementasi. Disusun 2026-09-09 dari 2 workflow multi-agen (16 agen,
        eksplorasi kode + adu-uji adversarial). Fitur dasar Siaran Audio sudah live di prod v1.4.30.
-->

# Siaran Audio — Roadmap Desa Digital (PA Jaringan)

Fitur **Siaran Audio** (live di prod v1.4.30) baru bisa mengirim audio ke **speaker kamera** lewat
ONVIF backchannel. Dokumen ini merancang perluasannya jadi **sistem PA (public address) jaringan**
dengan dua jenis endpoint output dan sumber audio yang lebih kaya, semuanya **ter-scope ke desa lokal**.

Prinsip yang dipegang di seluruh desain (dari fitur yang sudah ada):
- **Encode-sekali-saat-impor** → putar = streaming byte, nol ffmpeg per-play (jaga "server butut" tetap ringan).
- **Kredensial kamera tak pernah keluar server** (env ke child, tak pernah argv/frontend/perangkat).
- **cameraService.js BEKU** → semua logika baru di modul baru (<800 baris).
- **Migrasi** = skrip node standalone, `CREATE TABLE IF NOT EXISTS` / `PRAGMA table_info` guard, ledger `schema_migrations`.
- **Logging**: catat transisi + hitung-per-siklus, jangan per-item; `stderr` hanya untuk yang benar rusak.

---

## Ringkasan enam sumbu

| # | Sumbu | Inti | File baru utama |
|---|---|---|---|
| A | Deteksi kapabilitas kamera | Probe DESCRIBE-only senyap → tri-state tersimpan | `audioProbeService.js`, `audio_probe.py` |
| B | STB speaker-node | Endpoint audio pull (long-poll) + amp + TOA | `audioDeviceService.js` + agen Armbian |
| C | Target ter-scope lokal | `{kamera ber-audio} ∪ {STB}` per area allowlist (buang Surabaya) | `audioTargetService.js` |
| D | Impor dari tautan | URL file langsung (hari-1) + YouTube via `yt-dlp` (flag) | `audioImportService.js` |
| E | Penjadwalan fleksibel | recurring / once / range | (perluas `audioScheduleService.js`) |
| F | Live push-to-talk (PTT) | Mic HP/PC admin → speaker kamera/TOA real-time (ala ATCS DISHUB) | `audioTalkService.js`, `audio_talk.py`, `cameraAudioLock.js` |

---

## A — Deteksi otomatis kamera dukung two-way audio

**Masalah:** sekarang operator harus tahu manual kamera mana yang punya speaker backchannel (PS3E bisa,
S41FE tidak). Kita deteksi otomatis **tanpa membunyikan apa pun**.

### Mekanisme — probe DESCRIBE-only senyap
Handshake ONVIF backchannel yang sudah terbukti di `audio_cast.py`, **berhenti tepat setelah DESCRIBE**
(sebelum SETUP/RECORD/RTP). Audio baru mengalir di `play()` yang hanya dipanggil setelah SETUP+RECORD →
**berhenti di DESCRIBE = nol suara, nol alokasi backchannel**.

- URI: `rtsp://…/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif` (`proto=Onvif` WAJIB — itu yang memicu tawaran track backchannel).
- Header: `Accept: application/sdp` + `Require: www.onvif.org/ver20/backchannel`; auth Digest (401→ulang, qop).
- **Baca body SDP penuh** (hormati `Content-Length`) — jangan warisi baca-sampai-header dari `_request()`.

### Klasifikasi TRI-STATE (bukan boolean — koreksi adversarial penting)
Simpan di tabel `cameras` (kolom aditif, **TANPA DEFAULT** — belajar dari bug `video_codec DEFAULT 'H264'` yang bikin tiap baris berbohong):

| Kolom | Arti |
|---|---|
| `supports_audio_out INTEGER` | `NULL`=belum diprobe · `0`=terjangkau+ter-auth tapi tak ada track · `1`=didukung |
| `audio_out_checked_at TEXT` | ISO timestamp probe konklusif terakhir (sinyal staleness) |
| `audio_out_note TEXT` | bukti enum aman: `'sendonly trackID=5'` / `'no sendonly track'` / `'unreachable'` / `'auth-failed'` / `'551 unsupported'` |

**Aturan yang WAJIB dijaga:**
- **UNKNOWN ≠ UNSUPPORTED.** Tulis `0` HANYA pada DESCRIBE 200/auth-OK yang SDP-nya benar-benar tak punya track, atau penolakan eksplisit `551`/`501`. Timeout/connect-fail/`401`-tetap/5xx → **pertahankan keadaan (tetap `NULL`)** + backoff. (Sama kelas bug EHOSTUNREACH bobot-0.3 di health.)
- **Jangan pernah turunkan `1`→`0`** dari hasil inkonklusif.
- **Predikat SUPPORTED lebih ketat** dari cek `'sendonly'` mentah: `a=sendonly` tepat pada media dengan `a=control …trackID=5` **dan** codec PCMU ditawarkan; catat payload type sebenarnya (jangan asumsi PT=103) untuk deteksi mismatch.

### Higiene socket (koreksi adversarial)
Bangun probe dari primitif `rtspProbe.js`: **tutup socket dengan RST, bukan FIN** — kalau FIN, insiden
*session-table-exhaustion* (2026-08-19: `401`→false-offline→retry storm) bisa kembali. Timeout pendek (~4-5s connect + read) + hard-cap SIGKILL ~8-10s (jauh lebih pendek dari 8+15s `audio_cast.py`).

### Anti-drift: probe harus setara pusher
Faktorkan inti `connect + _authed + DESCRIBE` (konstanta BASE, header Require, digest) ke satu modul
Python bersama (`scripts/audio_rtsp.py`) yang di-import `audio_cast.py` **dan** `audio_probe.py` baru —
supaya DESCRIBE probe byte-identik dengan DESCRIBE pusher. Node: `services/audioProbeService.js` meniru
`runPusher` (spawn, creds via env, timeout pendek), map exit-code → `{supported|unsupported|unknown, reason}`.

### Cadence (hemat di box butut)
Tiga pemicu menulis ke cache tri-state:
1. **Saat kamera dibuat/diubah** (IP/RTSP/kredensial berubah) → `markStale(cameraId)` (set `checked_at=NULL`), **non-blocking** — JANGAN probe inline (RTSP timeout menggantung request tulis). Hook di `cameraSourceLifecycleService` (bukan `cameraService` beku).
2. **Tombol "Cek ulang"** di `/admin/audio` (satu kamera / semua).
3. **Sweep periodik lambat**: `setInterval` **primary-worker only** (via `audioBroadcastBootstrap`), `.unref()`, tiap **6 jam**, TTL cache **7 hari**, **maks 20 kamera/putaran** (terlama dulu). Cap konkurensi: per-NVR **2** (kelompok `rtsp:<host>` + jeda 1500ms, tiru `batchProbe`), global **2-3**. Skip kamera yang sedang broadcast (`isBusy`).

Modul baru `audioCapabilityService.js`. `listTargetCameras` meng-**anotasi** tri-state (jangan sembunyikan `unknown` — operator perlu lihat untuk memicu probe); jadwal strict `supported`.

---

## B — STB speaker-node (Armbian + amplifier + TOA)

Untuk lokasi yang kameranya tak dukung backchannel, tambahkan **STB murah (Armbian)** sebagai endpoint
audio: `STB → USB DAC → line-in power amplifier → horn TOA`. Server tetap "otak"; STB = **output murni**
yang **menarik** (pull) perintah + berkas.

### Kenapa PULL (long/short-poll), bukan server-push
STB duduk di LAN `172.17.x`/`192.168.x` di belakang NAT tanpa port inbound. Lebih penting: jaringan prod
ini **memutus HTTPS long-lived setelah beberapa detik** (terdokumentasi di `telegramBotService.js` → makanya
mereka pakai `getUpdates timeout=0` + idle-sleep). Jadi STB meniru pola itu: **short-poll balas-segera +
idle-sleep 3-5s**, arah device→server (arah yang terbukti bisa keluar, sama seperti hook MediaMTX kamera→server).
Server-push / hold-25s+recheck-DB-1s **ditolak** (verify agent: ~5-7× lebih berat, konstan menyita event-loop tunggal).

### Model server-side
Dua tabel + generalisasi dispatch. (Migrasi `zz_20260909_add_audio_devices.js`.)

**`audio_devices`** — endpoint terdaftar:
`id, name, area_id (FK areas ON DELETE SET NULL), token_hash (sha256, UNIQUE), token_prefix, hardware_id,
volume (0..100 default 80), status ('pending'|'active'|'disabled'|'revoked'), enabled, last_seen_at,
last_ip, last_ack_command_id (cursor, analog offset getUpdates), agent_version, created_by, created_at, updated_at`.

**`audio_device_commands`** — antrian durable (analog "update" Telegram, tapi kita yang pegang):
`id (PK monotonic = cursor), device_id (FK CASCADE), type ('play'|'stop'|'set_volume'|'test'), source_type,
source_id, loop_count, volume, play_at (instan WIB absolut untuk start serempak), fetch_token (acak,
least-privilege), expires_at (freshness guard), created_by, created_at, delivered_at, acked_at, result`.

Plus `ALTER TABLE audio_schedules ADD COLUMN device_ids TEXT DEFAULT '[]'` (idempoten, guard `PRAGMA table_info`).

### Dispatch: `playToCameras()` → `playToTargets()`
`playToTargets({ cameraIds=[], deviceIds=[], sourceType, sourceId, loop })`:
- `resolveSourceFiles()` dipanggil **sekali** untuk keduanya.
- **Kamera** = jalur lama (spawn `audio_cast.py`, busy-guard, creds via env). Hasil `{kind:'camera',…}`.
- **Device** = **ENQUEUE** baris `audio_device_commands` (bukan langsung bunyi — bunyi saat device poll). Device **offline → TIDAK enqueue**, lapor `{ok:false, message:'perangkat offline'}` (honesty: admin tahu pengumuman tak terdengar).
- `playToCameras()` dipertahankan sebagai **shim delegasi** agar pemanggil lama tak pecah.

### API device-facing — `/api/audio-device/*` (M2M, bearer per-device)
| Endpoint | Fungsi |
|---|---|
| `GET /poll?after=<cursor>` | balas `{commands, device:{volume}, poll_after_ms}`; update `last_seen_at`; majukan cursor |
| `GET /clip/:clipId?cmd=&k=<fetchToken>` | serve rendition **device** (`.dev.wav`), Range+ETag, scoped ke command |
| `POST /ack` | (opsional) heartbeat + hasil per-target |
| `POST /claim` | enrol via **claim-code single-use TTL** → device `pending` → **approval admin** |

**Keamanan (adu-uji ketat — semua WAJIB):**
- Gate bearer dipasang **preHandler tingkat-plugin** (`middleware/audioDeviceAuth.js`) — semua route device ter-gate *by construction*; tulis `request.audioDevice`, **bukan** `request.user`.
- Validasi token = **hash lalu lookup terindeks** `WHERE token_hash = ?` (jangan scan O(n) + `timingSafeEqual` per-baris). Cek `enabled=1 AND status NOT IN('disabled','revoked')` **tiap request**; rotate-token mematikan hash lama seketika.
- Exempt dari API-key + CSRF dengan **garis miring akhir**: `/api/audio-device/` (bukan telanjang). Route device **abaikan cookie** (CSRF-exempt + cookie-auth = lubang CSRF).
- **Rate-limit PER-TOKEN** (bucket `dev:<token_hash>`), **bukan** per-IP; JANGAN whitelist prefix dari limiter (banyak STB di belakang satu NAT = bucket-kolaps → 429 palsu). Tambah lapis pra-auth kecil per-IP untuk request tanpa bearer sah.
- **Klip di-fetch by `clipId`** dari base-URL yang device konfigurasi sendiri; command **tak pernah** bawa URL absolut. Endpoint clip verifikasi **tiga hal**: `bearer.device_id === command.device_id`, `fetch_token` cocok, belum expired. Serve via `clipPath(getClip(id).base_filename)` berpagar `SAFE_BASE_RE`.
- **Invarian diuji**: TIDAK ada endpoint device yang mengembalikan `private_rtsp_url`/kredensial kamera. Payload command = allowlist ketat `{clipId, loop, expires, play_at}`.
- Field dari device (agent_version, hardware_id, results) **untrusted**: length-cap, parameterized, dirender sebagai **teks** di admin UI (tutup pivot stored-XSS device→admin).
- nginx: `allow /api/audio-device/` **hanya dari subnet LAN** (172.17/16, 192.168/16), 403 dari WAN (defense-in-depth, tiru posture `/api/internal`). *(box-only: verifikasi routing/ufw saat prod online.)*

### Sinkronisasi start (koreksi adversarial)
Untuk beberapa horn/kamera di **zona akustik yang sama** start serempak:
- Command play bawa **`play_at`** (instan WIB absolut ~10-15s ke depan). Device yang sudah pegang command **tidur-sampai `play_at`** pakai jam **chrony** (monotonic). → **chrony `172.17.11.12` JUSTRU load-bearing** untuk start serempak (membalik asumsi "jam STB tak penting").
- **Prefetch**: kirim command cukup awal supaya tiap device fetch+cache klip **sebelum** `play_at` → semua start dari cache pada instan sama.
- Jika survei akustik membuktikan semua horn non-overlap → boleh terima jitter per-device (tanpa `play_at`).

### Freshness LIVE vs SCHEDULE (pisahkan)
- **Play-now** = `LIVE_FRESH_WINDOW` ~60-90s + skip-offline-with-report.
- **Jadwal** = **enqueue durable** tak peduli online sesaat + `SCHED_GRACE_WINDOW` ~5-10 mnt (device yang reconnect dalam grace TETAP memutar). Reaper hormati kedua window.
- **Delivery reporting** per jadwal-run; target offline/expired saat fire → **alert via Telegram** (jangan cuma `console.log` count).

### Stack perangkat STB (Armbian)
`apt install alsa-utils ffmpeg python3 chrony curl ca-certificates`. Agen **Python stdlib saja**
(`urllib`+`socket`, **tanpa pip** di lapangan).

- **Player** (satu jalur untuk semua format): `ffmpeg -i <cached .dev.wav> -af "alimiter=limit=0.95,volume=<trim>" -f s16le - | aplay -D <dev> -f S16_LE -r 48000 -c 1`. *(Loudness sudah di-bake saat impor — lihat §Kualitas; trim di sini cuma pengaman.)*
- **Audio out**: USB DAC kelas CM108/PCM2704 (banyak TV-box H616 HDMI-only tanpa analog out) → 3.5mm/RCA → **LINE-IN** amp (bukan mic-in) → TOA. Pin kartu ALSA **by-name** di `/etc/asound.conf` (index bisa reorder saat boot). Set trim gain amp aman **sekali** saat install; volume harian via `amixer` (default ~85%, plafon keras di device).
- **systemd** `speaker-node.service`: `Restart=always, RestartSec=3, StartLimitIntervalSec=0, WatchdogSec=120` + agen kirim `sd_notify WATCHDOG=1` tiap siklus (socket macet → restart cepat). `After=network-online.target chronyd.service sound.target`, `User=speaker` (grup audio).
- **chrony**: `server 172.17.11.12 iburst` + `makestep 1 3`.
- **Provisioning**: claim-code single-use (bukan enroll-secret fleet statis) → device `pending` → approval admin (node `pending` **tak pernah** jadi target). Token di `/etc/speaker-node/token` (0600).
- **Test tone** saat commissioning (`speaker-test -t sine -f 440 -l 1`), **DEFAULT OFF di produksi** (jangan horn bunyi tengah malam tiap restart).
- **Ketahanan**: overlayroot/tmpfs untuk log+cache (SD-wear), journald volatile, persist `last-acked command id` ke disk (reboot tak replay). Backoff jaringan 1s→maks 15-30s (« grace window).

### Kualitas audio — DUA rendition (koreksi adversarial: satu rendition FLAWED)
G.711 8/16kHz cukup untuk speaker mungil kamera, **jelek untuk musik/pengumuman lewat TOA + amp**.
Hasilkan **dua master dari ORIGINAL dalam SATU proses ffmpeg saat impor** (ffmpeg dukung 2 output/perintah):
- `<base>.ulaw` — jalur kamera (tak berubah).
- `<base>.dev.wav` — jalur device: **PCM s16le mono @48k** (match native DAC → `aplay` tak resample), dengan loudness **di-bake**: `-af loudnorm=I=-16:TP=-1.5:LRA=11, highpass=f=250, alimiter=limit=0.95` (EBU R128 + true-peak limiter ≤ -1 dBTP lindungi horn + high-pass buang sub-bass yang menyedot headroom).
- Buat `.dev.wav` **sebelum** `unlinkSync(tempPath)` di `saveAudioClip` (turunkan dari original, **jangan** dari `.ulaw`).
- **Klip lama** (original sudah terhapus): backfill; kalau terpaksa upsample `.ulaw→wav` = stopgap ber-label "kualitas telepon lewat PA" + prompt "unggah ulang".
- `.ulaw` **tak pernah** diserve ke device.

### Beban box (koreksi adversarial — verdict jadi BERSYARAT)
"Near-zero" hanya benar dengan: **short-poll + N kecil + klip via nginx + rendition pre-render**.
- **Serve klip via NGINX static** (alias ke `data/audio`, atau `X-Accel-Redirect` setelah cek bearer+command di Node) — **BUKAN** `reply.send(createReadStream)` di Node. Ini mitigasi paling penting: burst-fetch saat siaran keluar dari event-loop tunggal yang sedang stream HLS.
- **Hard limits**: interval poll `P` = 3-5s (latensi pengumuman ≤ P, wajar untuk PA); N nyaman ≤ ~20-25 device/box, plafon ~50. **Throttle `last_seen_at`** ke tiap ~30-60s (bukan tiap poll) — lindungi WAL bersama recording (tiru throttle heartbeat viewer 10s).

---

## C — Target ter-scope lokal (kenapa Surabaya ikut, dan fix-nya)

**Masalah nyata (bug di kode yang sudah live):** `listTargetCameras()` cuma filter `internal + ada RTSP`,
jadi ~15 kamera **internal Surabaya** `36.66.208.x` (yang 404) ikut muncul di picker.

**Fix deterministik — allowlist AREA, bukan regex IP:**
- Kolom baru `areas.audio_broadcast_enabled INTEGER NOT NULL DEFAULT 0`. **DEFAULT 0 load-bearing**: semua area impor ATCS + Surabaya otomatis OFF; admin nyalakan **hanya area desa** (Dander, Tanjungharjo) lewat toggle di Area management (sebelah `is_access_gated`). **Jangan** masukkan ke `PUBLIC_AREA_COLUMNS`.
- Modul baru `audioTargetService.js` → `listBroadcastTargets({ includeUnknown })` = **UNION**:
  - Kamera: `enabled=1 AND areas.audio_broadcast_enabled=1 AND stream_source='internal' AND private_rtsp_url≠'' AND supports_audio_out='supported'` (jadwal strict; picker manual boleh `IN('supported','unknown')` + badge).
  - Node STB: `audio_devices` di area yang sama.
- **Dua gate independen** membuang Surabaya: (a) gate area (load-bearing sejak menit-1 deploy, bahkan sebelum probe jalan); (b) gate kapabilitas (RTSP 404 tak akan pernah `supported`). **Jangan** hardcode/tebak `area_id` (prod unreachable) — nyalakan by-name di UI.

---

## D — Impor audio dari tautan (URL / YouTube)

**Reframe (adu-uji): jangan YT-first.** Ekspos sebagai **"Impor dari tautan"** generik, dua jalur:
- **Jalur utama = URL file media langsung** (`.mp3/.m4a/.wav/…`) → fetch Node ber-guard SSRF → pipeline encode yang sudah ada. **Tanpa dependensi box baru**, berguna hari-1, degradasi anggun.
- **YouTube = ekstra** via `yt-dlp`, di-gerbang flag `AUDIO_IMPORT_ENABLED` (**default OFF**) + deteksi `yt-dlp --version` (absen → **501**, bukan 500 crash).

### Model job ASINKRON (ekstraksi lambat — jangan blocking)
- `POST /clips/import` balas **202** + baris `audio_import_jobs`. Processor = ticker **primary-worker**, **konkurensi 1** (serial), **klaim atomik** (`UPDATE … SET status='processing' WHERE id=? AND status='queued'`, `changes()==1`). Boot **fail-forward** `processing→failed`. Request blocking ditolak (Cloudflare 524).
- Tabel `audio_import_jobs`: `id, source_url, source_kind ('youtube'|'url'), requested_name, status ('queued'|'processing'|'ready'|'failed'), clip_id (FK SET NULL), title, duration_sec, error, attempts, created_by, created_at, started_at, finished_at`. Index on `status`.
- Kolom baru di `audio_clips`: `source_type ('upload'|'youtube'|'url') DEFAULT 'upload'`, `source_url`, `source_title`.
- Refactor: inti encode+insert `audioClipService` → fungsi bersama `finalizeClipFromFile()` dipakai upload **dan** importer.

### Pengaman WAJIB (berlapis)
- **Probe metadata dulu** (`yt-dlp -J`/`--print`) → **tolak `is_live`** + durasi > `MAX_IMPORT_DURATION_SEC` (default 600s) **sebelum** unduh.
- **Cap byte berlapis**: `yt-dlp --max-filesize --no-playlist --no-cache-dir` **+** `ffmpeg -t <cap> -fs <bytes>` (belt & suspenders untuk livestream/durasi salah).
- **SSRF policy tersendiri** `backend/utils/audioImportUrlPolicy.js` — **jangan** reuse `outboundUrlPolicy` (tanpa blok privat) atau `rtspUrlPolicy` (izinkan RFC1918). Pinjam parse WHATWG + **tambah resolve DNS lalu TOLAK** RFC1918 (10/8, 172.16/12, 192.168/16), loopback, link-local, metadata `169.254.169.254`, `::1`; **https-only**; host **allowlist** untuk mode YT. (Box duduk di subnet kamera → SSRF ke kamera/metadata nyata.)
- **Child-proc aman**: URL sebagai **satu argumen positional setelah `--`**, divalidasi dulu, tanpa shell, tak pernah di-log.
- **Acknowledgement hak cipta/ToS** di UI sebelum impor (siaran ke speaker publik = keputusan operator terdokumentasi).

---

## E — Penjadwalan fleksibel

Perluas `audio_schedules` (satu tabel, bukan tabel baru) dengan `schedule_kind`:
- **`recurring`** (model sekarang: `days_mask` mingguan, tanpa batas tanggal).
- **`once`** (sekali pada `run_date`; `days_mask` diabaikan; **auto-disable** setelah fire).
- **`range`** (recurring mingguan TAPI hanya aktif dalam `[start_date, end_date]` inklusif; satu batas boleh NULL).

Migrasi `zz_20260909_add_audio_schedule_flex.js` (idempoten, `PRAGMA table_info`): tambah
`schedule_kind TEXT NOT NULL DEFAULT 'recurring'`, `run_date TEXT`, `start_date TEXT`, `end_date TEXT`
(semua `'YYYY-MM-DD'` kalender WIB, banding leksikal terhadap `dateKey` WIB).

`runDueSchedules()` — `wibParts()` kembalikan `dateKey`; evaluasi per kind (guard `last_run_at===minuteKey`
**tak berubah**): `once` → `run_date===dateKey` lalu `enabled=0`; `range` → `start≤dateKey≤end AND days_mask&dayBit`;
`recurring` → seperti sekarang. **`once` yang terlewat (box mati) di-DROP** (tak diledakkan di waktu acak) —
dokumentasikan ke operator agar tak dikira bug. Baris legacy (kolom default) tetap fire by-mask (backward-compat, ada tes regresi).

---

## F — Live push-to-talk (PTT / paging langsung)

**Tujuan:** admin dari **HP atau PC** buka web → tekan tombol "Bicara" → **suara dari mulut langsung keluar
real-time** di speaker kamera dan/atau STB→amp→TOA. Persis model **ATCS DISHUB** (operator menegur langsung
ke perempatan). Half-duplex (tekan-bicara), near-real-time.

**Kenapa bisa:** jalur backchannel yang sudah terbukti (`audio_cast.py`) mengalirkan RTP **real-time** (PT=103
PCMU/16000, 320 byte/20ms, dipacu-jam). Untuk live, **sumbernya diganti dari file → mikrofon**; wire-protocol ke
kamera **identik**.

### Transport — WebSocket + encode u-law DI BROWSER (bukan WebRTC/WHIP)
Keputusan kunci (adu-uji): **WebSocket**, bukan WebRTC/WHIP.
- MediaMTX v1.15.6 **mendukung WHIP**, tapi bind `127.0.0.1` + `/webrtc`→403 (gerbang hotlink). WHIP pun **tak bisa** mendorong ke backchannel ONVIF (MediaMTX tak bicara backchannel) → tetap butuh ffmpeg pull+transcode Opus→u-law → menambah beban tanpa hasil, dan **membuka kembali permukaan WebRTC/UDP** (regresi keamanan).
- **WS menang**: browser meng-encode **u-law 16k = persis payload RTP PT=103** → server **nol transcode** (relay byte murni ke stdin pusher). Tak menyentuh gerbang `/webrtc`. Auth admin JWT native di handshake. nginx **sudah upgrade-ready** di `/api/` (`proxy_http_version 1.1` + `Upgrade`).
- Butuh dep baru `@fastify/websocket` + `ws` (install saat box online).

**⚠️ BLOCKER nginx (satu-satunya edit nginx):** `deployment/nginx.conf` host SPA baris ~112
`Permissions-Policy "…microphone=()…"` **mematikan `getUserMedia`**. Ubah ke `microphone=(self)` **hanya di
host yang menyajikan halaman PTT**; pertahankan `microphone=()` di host lain.

### Sisi klien (HP + desktop)
- `getUserMedia` (dalam user-gesture) + `AudioContext({sampleRate:16000})` + **AudioWorklet** → frame 320-sample/20ms, **u-law encode di worklet** (`pcm16ToMulaw`, ~15 baris) → **WS biner 320 byte**. Kontrol (start/stop/target) = pesan JSON text (pisah via opcode). RMS → level meter.
- **Kirim silence 0xFF kontinu selama ON AIR** — backchannel + jitter-buffer kamera mengharap aliran kontinu; jeda bisa menutup track `sendonly`.
- Jika `context.sampleRate ≠ 16000` (sebagian Android 48k) → resample di worklet (jalur cepat) atau ffmpeg fallback di server. **BUKAN MediaRecorder/Opus** (tak ada framing 20ms, butuh transcode server, iOS spotty).
- **UX**: hold-to-talk (Pointer Events + `setPointerCapture`; `blur`/`visibilitychange`/`pagehide` → **STOP seketika**), slide-to-lock sekunder + auto-timeout, zone picker (reuse `CameraMultiSelect`, multi-target = paging zona), banner **ON AIR** (token broadcast/on-air tersendiri — **BUKAN `status-fault` merah**; honesty design-token), `navigator.vibrate`, **mute live HLS target** selama on-air (cegah howl).
- **PWA** walkie-talkie: shortcut di `admin.webmanifest` + `wakeLock`. **Wajib browser asli/PWA** — in-app webview (Telegram) memblokir `getUserMedia` (ini surface ADMIN, jadi beda dari surface publik).

### Sisi server
- **Auth WS via tiket** (browser tak bisa set header `Authorization` di WS): `POST /api/admin/audio/talk/ticket` (gate `authMiddleware`+`requireAdmin`+CSRF) → tiket **single-use TTL~30s** terikat `adminUserId`+`cameraId`. WS `/api/admin/audio/talk?ticket=…` → validasi tiket + **Origin/Sec-Fetch same-site** sebelum spawn.
- **Varian LIVE pusher** `scripts/audio_talk.py` yang **reuse `RtspTalk.open()/close()`** (idealnya faktorkan `RtspTalk` → `scripts/audio_rtsp.py` bersama, sejalan Sumbu A anti-drift). `talk_live()`: reader-thread baca stdin → **jitter-buffer terbatas** (2-4 frame, drop-oldest di ~10 high-water), **loop dipacu-jam** (bukan dipacu-data), **comfort-noise 0xFF saat starved** (timeline RTP tak pernah berhenti). Encoder u-law = **tabel pure-Python** (`audioop` hilang di py3.13). Bridge Node = **relay byte murni** ke `child.stdin` (nol ffmpeg); ffmpeg **hanya** jalur fallback (non-16k/Opus), di-cap keras.
- **Siklus**: START → pusher emit silence (tahan sesi) → READY → UI "ON AIR". STREAM → frame ke stdin (backpressure: **drop**, jangan buffer tak-terbatas) + ping ~10s (nginx `proxy_read_timeout 60s` / Cloudflare idle-drop). STOP → tutup stdin → **SIGTERM** (biar python TEARDOWN, **bukan** SIGKILL) → lepas lock. Dua timer: **hard-cap ~5 mnt** + **idle ~10-15s** tanpa frame nyata → auto-stop (sesi telantar tak boleh memaku kamera).

### Lock bersama (kritis) — clip + talk satu kunci
Faktorkan `busy` Set → **`cameraAudioLock.js`** yang dipakai **`playToCameras` (clip/playlist/jadwal) DAN `audioTalkService` (talk)** — supaya RTP ganda ke satu kamera (garble) mustahil.
- **Prioritas asimetris**: **live talk PREEMPT clip/jadwal**; clip **tak pernah** preempt talk. `runDueSchedules` **jangan** set `last_run_at` sebelum lock didapat — kalau kamera sedang PTT → skip-with-report (`"jadwal X terlewat: kamera sedang PTT"`), jangan konsumsi slot senyap.
- **`instances:1` (fork) load-bearing**: lock in-memory hanya benar di primary worker. Jika pindah cluster → lock **DB** `UNIQUE(camera_id)` atau pin WS talk ke worker-0.

### Keamanan (adu-uji — WAJIB)
- **Tolak WHIP/WebRTC ingress**; MediaMTX tetap `127.0.0.1` + `/webrtc`→403 tak disentuh.
- **Otorisasi per-target difilter `camera_class`**: audio **tak boleh** disiarkan ke speaker kamera `owner_private`/`subscriber` — perbaiki `listTargetCameras` + cek saat talk-start (invarian privasi di jalur **OUT**, bukan cuma `requireAdmin`).
- Creds RTSP **tak pernah** ke browser (browser kirim `cameraId`+tiket+byte u-law saja). WS reply/destroy **tepat sekali** (cegah regresi `ERR_HTTP_HEADERS_SENT`); tiap disconnect → **kill child + lepas lock**. Rate-limit POST mint-tiket, tapi **kecualikan WS mapan** dari limit per-pesan (sadar NAT-collapse CF-Connecting-IP). Audit `talk_start`/`talk_stop` (operator, kamera, durasi) — satu baris per event, **bukan per-frame**.

### Latensi (adu-uji — jangan sebut "1-2s" polos)
Term **dominan = buffer internal kamera** (box-only, di luar kendali kode).
- Kamera LAN on-site ~**0.5-1.2s** (bisa sub-detik); kamera remote-mobile via Cloudflare ~**0.6-2.0s+**; STB steady ~**1.0-1.5s** + join START **0..P** (interval poll 3-5s).
- "Cocok untuk menegur": **ya untuk paging satu-arah bila ≤~1.5s**; canggung mendekati/lewat 2s.
- STB live: **jangan** koalesir 400ms (itu untuk klip) — tulis tiap 1-2 frame + `TCP_NODELAY` (pangkas ~0.35s). **arm-then-talk**: tunggu STB "joined" sebelum bicara (kata pertama tak hilang). Operator on-site → tawarkan **jalur LAN direct** (lewati hairpin Cloudflare SIN).

### Leg STB (fase-2, reuse model Sumbu B)
Command baru `type='play_live'` + `source_type='talk'` (reuse skema `audio_device_commands`: `fetch_token`,
`expires_at`). **`expires_at` = deadline GABUNG (~40s), bukan durasi**; sekali tersambung, umur = **soket terbuka**
(server tutup response saat sesi berakhir). Server ekspos talk sebagai **chunked-HTTP terautentikasi** (Icecast-style)
`GET /api/audio-device/talk/:sessionId?cmd=&k=` (3-cek identik `/clip`, LAN-only). STB: `ffmpeg -f mulaw -ar 16000
-i <url> -flags low_delay | aplay` sampai EOF/stop. **Fan-out satu mic → N child kamera + N sink STB**, byte u-law
sama, nol transcode per-sink.

### Beban box (adu-uji — verdict BERSYARAT)
"Ringan" benar **hanya dengan nol-transcode di server** (SYARAT, bukan rekomendasi). **Batas keras**: maks **2 sesi
talk serentak** global; maks **3-5 kamera/sesi** (zona); maks **~16 STB listener/sesi**. Satu sesi = 1 handler WS +
1 child python ≈ 2-4% satu core. **Risiko nyata bukan CPU** melainkan box-only: apakah IMOU PS3E menahan RECORD
kontinu multi-menit + aliran silence tanpa teardown; jitter pacing 20ms saat ~20 ffmpeg jalan; latensi glass-to-glass.

---

## Lintas-sumbu

### Rekonsiliasi penamaan
Workflow menghasilkan dua penamaan device (`speaker_nodes`/`/api/speaker-node` vs `audio_devices`/`/api/audio-device`).
**Dokumen ini mengunci `audio_devices` + `/api/audio-device`** (konsisten namespace `audio_*`); agen fisik di STB tetap disebut "speaker-node".

### Verifikasi box — DIJALANKAN 2026-09-09 (prod terjangkau, probe SDP senyap nol-suara)
1. ✅ **SDP asli terkunci.** IMOU PS3E AHASS Dander (`192.168.12.6`) & Ngitik (`192.168.16.4`) → `m=audio a=sendonly`, menawarkan **`103=PCMU/16000`** (+ L16/16000, PCMA/16000), **`trackID=5` ADA**. Pusher (SETUP trackID=5 + PT=103) **VALID** untuk keduanya — dua kamera desa yang bisa disuarakan sekarang. S41FE (`192.168.12.2`) → **200 TANPA track audio** → UNSUPPORTED (cabang negatif = 200-tanpa-track, bukan 551).
2. ⚠️ **`trackID` TIDAK selalu 5.** 4 kamera lain punya `sendonly` di **trackID 1/2/3, codec PCMA/PCMU 8000** (bukan 16k, tanpa trackID=5) → pusher hardcode-5 **gagal** di sini. Cek `'sendonly'` mentah **over-count (6 vs 2 nyata)**. → **Predikat SUPPORTED wajib cocok trackID/codec yang di-SETUP**; untuk menambah cakupan, **generalisasi pusher baca `a=control` trackID + rtpmap dari SDP** (jangan hardcode 5/103). (Apakah 4 kamera itu benar punya backchannel butuh uji SETUP = berisiko suara → tunda.)
3. ✅ **UNKNOWN≠UNSUPPORTED terbukti live** (timeout/refused → UNKNOWN, bukan divonis 0).
4. ✅ **pm2**: backend `cluster_mode` **tapi 1 instance** (NODE_APP_INSTANCE=0) → scheduler + lock in-memory **aman SEKARANG**, tapi **RAPUH**: menaikkan `instances` diam-diam mematahkannya. Untuk B/F siapkan **lock DB** (`UNIQUE(camera_id)`) atau pin worker-0.
5. ✅ **yt-dlp MISSING** (validasi: URL-file jadi jalur utama, YT di-flag). python3.8 + `audioop` OK, ffmpeg `/usr/bin/ffmpeg`. **`@fastify/websocket` belum ada** (dep Sumbu F).
6. ✅ **Sumbu F nginx**: config **aktif** = `sites-available/rafnet-cctv`; `microphone=()` di host SPA **baris 124** → edit 1 baris jadi `microphone=(self)`. **`/webrtc` CLOSED (403)** di config aktif (file `cctv` yang `/webrtc`-terbuka **tidak ter-symlink/mati**). `/api/` **WS-upgrade-ready** (baris 218/355). MediaMTX **bind 127.0.0.1** (webrtc 8889, rtsp 8554).
7. ✅ **Surabaya**: **394 dari 414** kamera internal+RTSP = `36.66.208.x`. Sumbu C (scope area) **prioritas tinggi + WAJIB sebelum probe massal** (jangan probe 394 kamera remote).

**Sisa yang butuh uji BERISIKO-SUARA (tunda sampai aba-aba):** ketahanan backchannel PS3E menahan RECORD kontinu multi-menit + aliran silence 0xFF; latensi glass-to-glass mic→speaker (target sub-1.5s); Cloudflare/nginx menahan WSS aktif ~menit. Ini perlu SETUP/RECORD (membunyikan) — belum dijalankan.

### Urutan build yang disarankan
1. **A (deteksi kapabilitas)** — nilai tertinggi, kecil, sekaligus fondasi scope. `audio_probe.py` + `audioCapabilityService` + migrasi kolom + tombol "cek ulang" + badge.
2. **C (scope area)** — kolom `areas.audio_broadcast_enabled` + `audioTargetService`. Langsung buang Surabaya. (A+C kecil, bisa satu rilis.)
3. **E (penjadwalan fleksibel)** — perluasan murni `audioScheduleService`, murah.
4. **D (impor dari tautan)** — jalur URL-file dulu (tanpa dep box), YT di belakang flag.
5. **B (STB speaker-node)** — paling besar; server-side (tabel + `/api/audio-device` + `playToTargets` + rendition `.dev.wav` + nginx) lalu agen Armbian. Butuh verifikasi box paling banyak.
6. **F (Live PTT)** — bisa **paralel dengan B** karena berbagi `cameraAudioLock.js`, tiket auth, dan (leg STB) model device. Fase-1 = jalur **kamera saja** (WS + `audio_talk.py` + lock + tiket + UI hold-to-talk + edit nginx `microphone=(self)`); leg **STB-live** menyusul setelah B. Butuh verifikasi box latensi/ketahanan backchannel.

Semua migrasi backup `data/cctv.db` via `.backup` (WAL-safe, **bukan** `cp`) dulu. Semua file baru <800 baris;
`cameraService.js` tak disentuh. Deploy lewat kereta rilis (tag → `release-channels.json` → safe-deploy), seperti v1.4.30.
