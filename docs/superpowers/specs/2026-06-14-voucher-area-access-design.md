# Voucher Area Access — Design Spec (2026-06-14)

Status: Phase 1-3 + Phase 4a (admin API) + 4b (admin UI) SHIPPED (skema + service + GATE + cookie +
API publik + PEMBAYARAN mandiri + admin endpoints + halaman admin React, additive, flag OFF). SISA:
UI PUBLIK (kamera terkunci + halaman klaim/poll QR + form redeem /buka) + Phase 5 (aktivasi: gate
WebRTC infra + purge CDN). Lihat "Implementation status" di bawah.

## Implementation status — Phase 4 (admin) shipped 2026-06-15

- **4a backend** (`commit ae4281f`): admin endpoints `/api/admin/voucher/*` (requireAdmin) —
  `settings` (flag + gated_area_ids), `areas/:id/gate`, `profiles` CRUD, `profiles/:id/codes`
  (generate), `codes` + `codes/:id/revoke`. Thin glue di atas voucherService. Tes voucherAdminRoutes.
- **4b frontend service** (`commit e16ed0d`): `voucherAdminService` + `voucherPublicService`.
- **4b admin UI** (`commit a61b71a`): halaman `pages/VoucherManagement.jsx` di route `/admin/voucher`
  (lazy di App.jsx + nav "Voucher Akses" di AdminLayout, adminOnly) — toggle flag, toggle area
  berbayar, CRUD profil (modal durasi value+satuan/harga/maks-pemakai/area-bundle), generate kode
  batch (salin/cetak) + daftar/cabut. Tes `VoucherManagement.test` (5). Lint bersih.
  GOTCHA: mock `useNotification` di test HARUS objek stabil (hoisted) — kalau fresh tiap render,
  `notifyError` ganti identitas → `loadData` useCallback → useEffect reload loop tak henti.
- **SISA Phase 4 (UI publik):** overlay kamera terkunci di landing/stream-list (derive lock dari
  `GET /api/voucher/access`: area ∈ gated_area_ids & ∉ accessible_area_ids), halaman klaim/poll QR
  (createOrder → poll getOrderStatus → tampil kode + buka), form redeem `/buka` (voucherPublicService
  sudah ada). Suite frontend 588/589 hijau (1 gagal PRE-EXISTING & tak terkait: LandingCameraCard
  view-stats test stale — di-flag terpisah).

## Implementation status & keputusan terkunci (Phase 1 — 2026-06-14)

Phase 1 men-ship: migrasi `zz_20260614_add_voucher_access.js`, `services/voucherService.js`,
`__tests__/voucherService.test.js` (26 test hijau; suite penuh 1010/1010). Setelah review adversarial
3-lensa, beberapa detail §4/§5 di bawah **digantikan** oleh keputusan final ini:

- **Nama kolom final** (canonical, beda dari draft §4): `duration_minutes` (bukan duration_value+unit —
  tapi service tetap menerima `duration_value`+`duration_unit` sebagai input lalu dikonversi),
  `max_uses_per_code` (menggantikan "maks device"/per-code cap), `code_validity_days` (masa hangus),
  tabel ber-prefix `voucher_` (`voucher_profiles`, `voucher_profile_areas`, `voucher_codes`,
  `voucher_redemptions`), kolom `areas.is_access_gated`.
- **Knob yang DITUNDA** (tidak di Phase 1): `max_redemptions` (kuota total per profil) dan
  `per_buyer_limit`. Phase 1 hanya punya cap per-kode (`max_uses_per_code`). Tambahkan nanti bila perlu.
- **Identitas akses = bukti kepemilikan kode pada perangkat.** `getAccessibleAreaIds` HANYA berbasis
  `voucher_redemptions.device_hash`. **Phone (buyer_phone) = kontak/struk saja, BUKAN kredensial akses**
  (unverified + mudah ditebak). Portabilitas antar-device = **masukkan ulang kode** di device baru (jadi
  redemption baru, tetap dibatasi `max_uses_per_code`). Phone dikanonikalisasi (+62/62 → 0) untuk
  konsistensi penyimpanan.
- **Stacking ("bisa add") = menyimpan beberapa kode**, bukan perpanjang satu kode di tempat.
  `getAccessibleAreaIds` meng-union semua area dari kode yang masih aktif → beli kode lain = nambah
  cakupan/waktu. Redeem ulang kode yang SAMA tidak memperpanjang `expires_at` (hanya menambah device
  s/d cap). (Draft §5 yang menyebut `expires_at += durasi` digantikan oleh keputusan ini.)
- **Fail-closed**: akses hanya untuk kode `active` dengan `expires_at` non-null & di masa depan.

## Implementation status — Phase 2 (gerbang LIVE) shipped 2026-06-14

Semua di balik flag OFF; saat off perilaku publik byte-identik (suite 1025/1025 hijau).

- **Gerbang terpusat di `canViewLive`** (cameraAccessService): cabang voucher untuk kamera
  community / published-public — butuh pass aktif untuk device (`voucherService.hasAreaAccess`) bila
  area gated + fitur on; staff bypass; mengembalikan `voucherGated` di SEMUA outcome (untuk cache).
  `area_id` ditambah ke ACCESS_PROJECTION. Camera_class TIDAK disentuh.
- **Semua choke point live** kini oper `voucherDeviceHash` + buang short-circuit `=== community`:
  internal `/hls` (hlsProxyRoutes), proxy eksternal (`hlsProxyService` + `externalStreamProxyService`),
  `streamService.getStreamUrls`/`generateStreamToken` (+ streamController).
- **Identitas = cookie `vdev`** (signed httpOnly, random 24-byte = bearer tak tertebak; `voucherPass.js`).
  Diset saat redeem, dibaca tiap request stream. Bukan phone (phone tetap kontak saja).
- **Anti cache-bocor**: gate set `request.voucherPrivate`; global `onSend` hook (server.js) paksa
  `private, no-store` → segmen gated tak pernah masuk shared/edge cache (CDN). Internal path juga
  set no-store langsung (belt+suspenders).
- **API publik**: `POST /api/voucher/redeem` (kode→cookie→area_ids), `GET /api/voucher/access`
  (`{enabled, gated_area_ids, accessible_area_ids}`). Frontend render gembok dari `/access`
  (mengganti rencana draft "PUBLIC_LIVE_SQL locked payload" — lebih ringan, tak menyentuh read-model
  kamera). Redeem balas pesan generik (anti-oracle).
- **Sengaja TIDAK digate (scope)**: thumbnail kamera gated tetap publik (umpan); **public PLAYBACK**
  kamera gated belum digate — fitur ini fokus LIVE. Tinjau di fase lanjut bila klien ingin playback
  ikut terkunci.

## Implementation status — Phase 3 (pembayaran mandiri) shipped 2026-06-14

Self-serve: pilih paket → bayar iPaymu QRIS → webhook/poll → otomatis terbit + aktivasi 1 kode untuk
device pembeli. **ISOLASI (keputusan D1): tabel `voucher_orders` terpisah; tabel billing `payments`
TIDAK disentuh.**

- `voucher_orders` (migrasi `zz_20260614b`): satu order pembayaran (profil, pembeli nama+HP,
  device_hash, gateway_ref iPaymu, amount, status, qris_payload, code_id, expiry).
- `voucherOrderService`: `createOrder` (iPaymu `/payment/direct`; reuse pending duplikat), `syncOrder`
  (re-query `/transaction`, throttled 15s), `handleWebhook` (body untrusted → re-query API),
  `_confirmOrder` (guarded flip pending→paid + `_ensureCodeIssued` = exactly-once + crash-recovery).
  Confirm → `voucherService.generateCodes(source:'self')` → set `code_id` → `redeemCode` aktivasi untuk
  device pembeli.
- `utils/ipaymuClient.js`: klien iPaymu signed standalone (sengaja DIPISAH dari paymentService demi
  isolasi; paymentService tak disentuh). Ada duplikasi signing kecil — future task bisa DRY.
- API publik: `POST /api/voucher/order` (→ QR; set cookie `vdev` di muka), `GET
  /api/voucher/order/:id/status` (poll; hanya device pemilik), `POST /api/voucher/webhook/ipaymu`
  (urlencoded, CSRF-exempt, re-verify ke API). Cookie diset saat order → device sama dapat akses saat lunas.
- **Anti free-access**: konfirmasi HANYA bila iPaymu lapor `paid` + amount cukup (guard mismatch);
  webhook tak pernah percaya body; exactly-once via guarded flip. Uang INTEGER rupiah.
- Gateway Phase 3 = **iPaymu** (aktif). Midtrans/GoPay-direct = follow-up (createOrder tinggal ditambah
  cabang gateway). Tes: `voucherOrderService.test` (11) + route/webhook. Suite penuh 1046/1046.

### Blocker aktivasi (Phase 5) + keputusan dari review Phase 2 (2026-06-14)

Gerbang HLS/cache/cookie sudah rapat & terverifikasi (onSend override cache HIT+MISS; nginx hormati
no-store; cookie signed httpOnly 192-bit; tak ada token-bypass). Yang TERSISA sebelum fitur boleh
dinyalakan sebagai paywall keras:

- **WebRTC ungated (residual INFRA) — BLOCKER paywall.** `/webrtc/*` diproxy nginx langsung ke
  MediaMTX (`webrtcAllowOrigin '*'`), tanpa gerbang backend. Read-model SUDAH tidak menyiarkan URL
  webrtc untuk kamera gated (list publik sembunyikan SEMUA URL; detail/pass-holder hanya URL HLS
  gated), TAPI pemegang pass masih bisa menurunkan stream key dari URL HLS lalu share via
  `/webrtc/{key}`. Untuk paywall keras: **gate `/webrtc` di nginx/MediaMTX** (auth per-path) ATAU
  nonaktifkan WebRTC untuk deployment ini. Tanpa ini, gating bersifat "lunak" di lapisan app.
- **Purge CDN saat pertama meng-gate sebuah area.** Segmen community yang sudah ter-cache Cloudflare
  `public, immutable` bisa terlayan ke non-pass-holder s/d TTL (~60s) habis. Purge `/hls` +
  `/external-segment` saat flag dinyalakan (runbook Phase 5).
- **PLAYBACK kamera gated belum dikunci (keputusan produk).** `recordingPlaybackService` hanya menolak
  non-community; kamera gated tetap community → rekamannya bisa ditonton gratis bila public-playback
  aktif untuk area itu. Fitur ini fokus LIVE. Bila klien ingin playback ikut terkunci, tambah cabang
  voucher di `resolvePlaybackAccess` (mirror canViewLive). Catatan: banyak deployment mematikan public
  playback demi privasi → kondisi bocor ini sempit.
- **`/api/stream/:id` + `/token` JSON** tidak ditandai no-store untuk kamera gated — BUKAN bypass (URL
  HLS-nya tetap gated cookie; stream token tak bypass gerbang voucher community). Defense-in-depth saja.

### Pengingat WAJIB untuk Phase 2/3 (dari review Phase 1)
- **Endpoint redeem publik `/buka` (Phase 3) WAJIB rate-limit** per-IP + per-device, dan kembalikan
  **satu pesan error generik** untuk semua kasus tak-bisa-ditebus (kode salah/dicabut/kadaluwarsa) agar
  tidak jadi oracle keberadaan kode. (Pesan spesifik saat ini hanya untuk layanan/admin.)
- **Kuota multi-proses**: cek `max_uses_per_code` di `redeemCode` membaca via koneksi READ (committed
  snapshot). Benar selama deployment **single-writer (PM2 instances:1)**; UNIQUE(code_id, device_hash)
  mem-backstop same-device. Jika nanti clustered/multi-proses, pindahkan cek count ke koneksi WRITE.
- **Legacy `migrations/run_all_migrations.js` (garis bawah) orphaned/stale** — bukan runner aktif. Jangan
  dipakai; dibersihkan via task terpisah.

## 1. Tujuan

Membatasi akses **live** CCTV publik **per-area**, dibuka lewat **kode voucher berdurasi**
(model "profil voucher Mikrotik"). Sepenuhnya **toggle di admin (default OFF)** — ini fitur custom
per-client, deployment lain tidak boleh terdampak. Identitas pembeli = **nama + no HP** (tanpa OTP).
Dua jalur penerbitan kode: **mandiri** (end user bayar sendiri) + **admin-generate** (komplimen).

## 2. Prinsip kunci (jangan dilanggar)

- **Akses = voucher, lepas dari pembayaran.** Rail uang bisa diganti kapan saja tanpa bongkar fitur.
- **Overlay di atas kamera `community`** — TIDAK menyentuh `camera_class`. Aturan "non-community tidak
  pernah tampil publik" tetap utuh. Gating ini lapisan terpisah.
- **Default OFF** (flag global) + **opt-in eksplisit per-area** → deployment lain identik perilakunya.
- Uang = **INTEGER rupiah**. Konfirmasi pembayaran **exactly-once**. Migrasi **additive + idempoten**.

## 3. Scope

- **SEKARANG:** gateway = **iPaymu QRIS** (sudah terpasang; GoPay bisa membayar via QRIS). Gate akses +
  voucher + halaman klaim + admin CRUD + jalur admin-generate.
- **NANTI (out of scope spec ini):** GoPay-merchant direct / Midtrans (cukup ganti setting gateway),
  pengiriman kode via WhatsApp. Lihat tabel banding gateway di catatan diskusi.

## 4. Data model (tabel baru, snake_case)

- **voucher_profiles** — template (gaya "user profile" Mikrotik)
  `id, name, description, duration_value, duration_unit ('hari'|'jam'), max_devices DEFAULT 1,
   price INTEGER, max_redemptions (kuota total, NULL=unlimited), per_buyer_limit DEFAULT 1,
   code_validity_until (batas tebus, NULL=tanpa batas), online_purchasable (0/1),
   active (0/1), created_at`
  → mirror knob `promo_codes`: `max_redemptions`↔`max_uses`, `code_validity_until`↔`expires_at`,
    `per_buyer_limit`↔`per_user_limit`.
- **profile_areas** — bundle area (many-to-many) `PRIMARY KEY(profile_id, area_id)`
- **voucher_codes**
  `id, code UNIQUE, profile_id, status ('unused'|'active'|'expired'|'revoked'), source ('self'|'admin'),
   buyer_name, buyer_phone, activated_at, expires_at, devices_count DEFAULT 0,
   order_ref (NULL utk admin-generate), created_at, created_by`
- **voucher_redemptions** — 1 baris per device (enforce `max_devices` + audit)
  `id, code_id, device_hash, buyer_name, buyer_phone, created_at`
- **areas.is_access_gated** INTEGER DEFAULT 0 — penanda eksplisit area "berbayar".
- **settings** key `voucher_access_enabled` default `'0'` — flag global fitur.

## 5. Alur

### Alur 1 — Mandiri (self-serve)
1. Kamera di area tergate tampil **terkunci** (thumbnail boleh, live diblok) + CTA "Buka area ini".
2. User pilih profil (yang `online_purchasable` & meng-cover area itu) → isi **nama + HP**.
3. Buat order pembayaran (iPaymu QRIS) → tampil QR di **halaman klaim** `/buka?ref=...`.
4. Halaman klaim **polling status** (reuse throttle `syncIpaymuPayment`). **Webhook = sumber kebenaran.**
5. Lunas → terbitkan `voucher_code` dari profil → tampilkan kode + **set cookie area-pass** → stream
   terbuka.
6. Kode = **kunci portabel** (dipakai di device lain s/d `max_devices`; bisa dikirim via WA nanti).

### Alur 2 — Admin generate
- Admin pilih profil → **generate N kode** (batch) status `unused` → cetak/bagikan. Boleh pre-bind
  nama+HP atau kosong. Gratis (tanpa order). Untuk komplimen/pengurus RW/uji.

### Redeem (kedua alur)
- User buka `/buka`, masukkan **kode + nama + HP**.
- Validasi: kode ada; `unused`/`active`; belum lewat `code_validity_until`; kuota `max_redemptions`
  belum habis; device belum lewat `max_devices`.
- Aktivasi: set `activated_at` (jika belum); `expires_at = activated_at + durasi`. **Stacking** (sesuai
  keputusan "bisa add"): jika masih aktif lalu beli/redeem lagi → `expires_at += durasi`; beli paket
  area lain → area digabung. Catat redemption (`device_hash`), terbitkan **cookie/JWT area-pass**
  `{ area_ids, exp }`.

## 6. Titik enforcement (file persis)

- **`backend/services/cameraAccessService.js` → `canViewLive()`**: tambah cabang — jika
  `voucher_access_enabled` ON **dan** area kamera `is_access_gated` **dan** bukan staff/owner/token →
  wajib **area-pass aktif** yang meng-cover area; jika tidak → 402/403. Cache 30s tetap; pakai
  cookie/JWT agar tidak query DB per segmen. Perlu menambah `area_id` ke `ACCESS_PROJECTION`.
- **`backend/utils/cameraVisibility.js` → `PUBLIC_LIVE_SQL`**: kamera tergate **TETAP tampil**
  (tetap `community`), tapi payload diberi flag `locked` agar frontend render gembok + CTA. Listing
  TIDAK disembunyikan (demi konversi). (Opsional: setting admin "kunci" vs "sembunyikan".)
- **Pembayaran (Alur 1)**: reuse fungsi driver iPaymu yang sudah diekspor
  (`buildIpaymuSignature`, `ipaymuRequest`, `interpretIpaymuTransaction`, pola re-query/poll +
  guarded-flip exactly-once). Penempatan order → lihat **D1**.

## 7. D1 — KEPUTUSAN TERBUKA (konfirmasi sebelum Phase 3)

Tempat order pembayaran voucher: **reuse `payments`** (+ kolom `purpose`/`meta`, `user_id` nullable)
**vs tabel terpisah `voucher_orders`**.

- **Reuse `payments`**: webhook `/api/billing/webhook/ipaymu` "langsung jalan" (satu lookup); warisi
  semua exactly-once. **Risiko:** ALTER tabel uang inti + `user_id` nullable (sensitif — pernah ada
  insiden data hilang di jalur billing).
- **Isolasi `voucher_orders`**: aman & terpisah dari billing existing; reuse *fungsi* driver iPaymu tapi
  bukan *tabel*-nya. **Biaya:** webhook harus cek dua tabel (payments → voucher_orders).
- **LEAN: isolasi** (prioritas keamanan billing). **Phase 1–2 tidak tergantung D1**, jadi eksekusi bisa
  mulai tanpa menunggu keputusan ini.

## 8. Keamanan & anti-abuse

- Kode acak cukup panjang; **rate-limit** endpoint redeem; `per_buyer_limit` + `max_devices`.
- **Cabut voucher** → akses mati walau cookie masih ada (re-check berkala ke `voucher_codes`).
- HP tidak diverifikasi (tanpa OTP) — **kode berbayar = kredensial sebenarnya**; HP hanya kontak/struk.
- Webhook iPaymu tanpa signature → **tetap re-query** ke API (pola yang sudah ada), tidak percaya body.

## 9. Rencana bertahap (tiap fase teruji + reversible, semua di balik flag OFF)

- **Phase 1** — Migrasi (4 tabel + `areas.is_access_gated` + settings flag) + `voucherService`
  (CRUD profil, generate batch, redeem, expiry, stacking) + unit test. **NOL dampak** ke flow lama.
- **Phase 2** — Gate: cabang `canViewLive` + payload `locked` di `PUBLIC_LIVE_SQL` + test. Selama flag
  OFF, perilaku publik **identik**.
- **Phase 3** — Pembayaran: order voucher iPaymu + konfirmasi→terbit kode + halaman klaim/polling.
  *(butuh D1)*
- **Phase 4** — Admin UI (tab Voucher: profil CRUD + generate + daftar/cabut) + UI kamera terkunci +
  form redeem publik.
- **Phase 5** — Verifikasi end-to-end (akun uji + iPaymu sandbox), lalu aktifkan flag untuk area uji.

## 10. Prod-safety (wajib)

- **Backup `data/cctv.db` sebelum migrasi di prod.** Migrasi additive + idempoten (CREATE IF NOT EXISTS,
  ALTER digerbang `PRAGMA table_info`).
- **Jangan mutasi prod DB untuk verifikasi** — pakai akun uji / rollback / DB-copy.
- Flag global **default OFF** → fitur tidak aktif sampai admin menyalakan + verifikasi.
