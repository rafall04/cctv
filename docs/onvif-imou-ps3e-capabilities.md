# ONVIF IMOU PS3E — kemampuan nyata & peta jalan

> Hasil eksplorasi + uji langsung ONVIF pada kamera IMOU **IPC-PS3E-8Q0** (firmware
> `3.11.0000000.3.R 2026-05-12`), 12 Sep 2026. Diuji live di 3 kamera prod: 192.168.12.6 (AHASS
> Dander, id 1441), 192.168.16.4 (Pasar Ngitik, id 1447), 192.168.12.7 (privat, id 1451).
> Semua probe **read-only** (GET + PullPoint efemeral). Tiap klaim di bawah sudah lewat verifikasi
> adversarial terhadap bukti probe mentah — status ditandai **[TERBUKTI] / [PERLU UJI] / [PERLU UBAH CONFIG]**.

---

## 1. Ringkas temuan uji langsung (yang BENAR-BENAR lewat ONVIF di kamera ini)

- **Langganan event PullPoint** — `WSPullPointSupport=true`, `MaxPullPoints=3`. `MotionAlarm`
  (`tns1:VideoSource/MotionAlarm`) terbukti pernah fire di produksi. Server bisa menahan langganan
  tanpa decode video.
- **Substream H.264 640×352 15fps (Profile001)** — **[TERBUKTI]** via ffprobe di 1441 & 1447:
  main (subtype=0) = **HEVC/H.265 3840×2160 @25fps**; sub (subtype=1) = **H.264 640×352 @15fps**.
- **Snapshot via ONVIF** — `media2 SnapshotUri=true`; `GetSnapshotUri` → `http://IP/onvifsnapshot/...`
  (URI dikembalikan; belum di-fetch sesi ini).
- **Track metadata analitik sel** di RTSP — `MetadataConfiguration Analytics=true`,
  `CellBasedSceneDescriptionSupported=true` (posisi sel-grid aktif bisa distream tanpa decode frame penuh).
- **Audio dua arah** — mic on-camera (`AudioSources=1`, AAC 16kHz) DAN backchannel output
  (`AudioOutput000`) sama-sama diiklankan ONVIF. (Push audio ke speaker di produksi lewat RTSP
  backchannel `&proto=Onvif` trackID=5 — `audio_cast.py` — bukan perintah SOAP ONVIF.)
- **Kontrol imaging settable (diiklankan)** — IrCut `ON/OFF/AUTO`, WDR `Mode ON/OFF Level 0-100`;
  kini IrCut=AUTO, WDR=OFF. **Belum ada operasi SET yang dijalankan.**
- **Topik tamper + scene-change** diiklankan (`tns1:RuleEngine/TamperDetector/Tamper`,
  `tns1:VideoSource/GlobalSceneChange`) — **belum teramati fire**.
- **Jam**: `DateTimeType=Manual`, TZ GMT+07:00, tanpa NTP client — dipelihara server yang push
  `SetSystemDateAndTime` (mekanisme produksi yang sudah jalan).
- **Node PTZ**: hanya **e-PTZ digital** dalam frame 4K (PanTilt -1..1, Zoom 0..1, ≤8 preset).
  PS3E = turret tetap, **tanpa gerak mekanis**. Belum ada Move/preset diuji.

Catatan: satu-satunya modul analitik = **cell-motion** dalam zona deteksi yang saat ini **sparse**
(`ActiveCells=0P8A8A==`); uji 120 detik menangkap **0 event**. Belum ada angka penghematan CPU terukur.

---

## 2. Koreksi penting: soal "kamera mengklasifikasi objek"

**Firmware ini TIDAK memberikan klasifikasi manusia/kendaraan sisi-kamera ke server.**

- Topic set ONVIF **tetap** (`FixedTopicSet=TRUE`), hanya cell-motion, tamper, dan scene-change —
  **tidak ada** topik person/vehicle/object/line-cross/face/plate.
- Satu-satunya modul analitik = `tt:CellMotionEngine`. Endpoint CGI smart-detection IMOU
  **tidak merespons** (timeout — CGI diblokir/di-strip firmware ini).
- Konsekuensi: **label "manusia vs kendaraan" apa pun berasal dari YOLO/OpenVINO server, bukan kamera.**
  Kamera hanya mengeluarkan gerakan sel-grid kasar.
- Apakah **SMD (Smart Motion Detection)** di aplikasi IMOU membuat `MotionAlarm` hanya fire pada
  manusia/kendaraan: **belum diuji, belum terbukti** — nol bukti ke arah mana pun. Hipotesis, bukan andalan.

---

## 3. Peta jalan pemanfaatan (server lebih ringan) — bertahap

**A. Decode SUBSTREAM (Profile001, H.264 640×352) untuk YOLO, bukan main 4K H.265.**
— **[TERBUKTI]** substream ada & H.264 (ffprobe 1441/1447). Lever offload paling langsung: decode
640×352 ≈ 33× lebih sedikit piksel dari 3840×2160, dan karena substream **H264** sekaligus
**menghindari kerusakan OpenVINO/motion.py di H.265** (lihat `project_ronda_motion_h265_codec_agnostic`).
Bermanfaat **tanpa** mengubah pipeline event. **[PERLU UJI]** besar penghematan CPU belum diukur.

**B. Event-driven: PullPoint (tanpa decode) → saat `MotionAlarm` tarik 1 snapshot → YOLO sekali.**
— Mekanisme **[TERBUKTI]** didukung. Penurunan CPU / bisa **menggantikan** decode 24/7: **[PERLU UJI]**
— hipotesis belum terukur; cell-motion kasar di zona sparse (0 event/120s) → **cakupan & recall wajib
divalidasi**. Batas: hanya **3 slot PullPoint** (fan-out dari satu langganan), dan
`PersistenNotificationStorage=false` → **event saat tak ada subscriber HILANG** (tanpa buffer).

**C. Snapshot per-event via endpoint ONVIF, ganti grab ffmpeg.** — **[TERBUKTI]** endpoint ada.
**[PERLU UJI]** belum di-fetch, belum ada perbandingan CPU. URI polos `http://` (lihat §4 TLS).

**D. Track metadata sel (RTSP) untuk seed ROI YOLO ke sel aktif.** — **[TERBUKTI]** diiklankan.
**[PERLU UJI]** langganan & verifikasi posisi sel benar terkirim; lebih kaya dari boolean `MotionAlarm`.

**E. Setel cell-motion agar trigger andal (bila ONVIF motion jadi gate).** — **[PERLU UBAH CONFIG]**
`SetVideoAnalyticsConfiguration` untuk memperluas `ActiveCells` **dan** menyetel `MinCount=32`,
`Sensitivity=60`, `AlarmOnDelay/OffDelay=1000ms`. **[PERLU UJI]** — dan **belum terbukti** bahwa mask
`CellMotionDetector` mengatur topik `VideoSource/MotionAlarm` yang dipakai produksi (dua topik berbeda!).

**F. Audio input sebagai kanal sinyal kedua (murah, lepas dari video).** — **[TERBUKTI]** mic tersedia.
**[PERLU UJI]** deteksi dini berbasis suara (teriakan, pecah kaca, alarm) untuk AI early-warning.

**G. Tuning imaging untuk deteksi malam/backlit.** — **[PERLU UBAH CONFIG]** IrCut/WDR via
`SetImagingSettings`. **[PERLU UJI]** belum ada SET ditulis; perbaikan kualitas masih ekspektasi.

**H. Alert tamper + scene-change (anti-vandal kamera publik).** — **[TERBUKTI]** topik diiklankan.
**[PERLU UJI]** belum teramati fire — konfirmasi live dulu.

**I. Sinkron jam** — **[TERBUKTI]** sudah jalan (server push `SetSystemDateAndTime`, satu-satunya jalur).

**J. (Opsional) Gating SMD dari aplikasi IMOU.** — **[PERLU UJI]** murni eksperimen, nol bukti.

---

## 4. Yang TIDAK tersedia di firmware ini (biar tak salah rencana)

- **Tidak ada klasifikasi objek sisi-kamera** (person/vehicle) — hanya cell-motion.
- **Tidak ada edge recording/replay ONVIF** — tak ada Profile G, `StorageConfiguration=0`,
  Recording/Search fault. Perekaman **tidak bisa** di-offload ke kamera.
- **Tidak ada relay OUTPUT fisik** (`RelayOutputs=0`) **dan tidak ada alarm input digital**
  (`DigitalInputs=0`). ⚠️ Topik `tns1:Device/Trigger/DigitalInput` **diiklankan** tapi **tak akan fire**
  (tak ada hardware) — jangan bangun trigger di atasnya.
- **Tidak ada NTP client on-camera** (`NTP=0`) — jam hanya via push server.
- **Tidak ada PTZ mekanis** — hanya e-PTZ digital, belum diuji.
- **Tidak ada TLS** (`TLS1.0/1.1/1.2=false`) — ONVIF/SOAP + kontrol + snapshot semua **HTTP polos + digest**.
  Password terlindung digest, tapi body perintah & snapshot URI tak terenkripsi. Batas postur keamanan.
- **Tanpa penyimpanan notifikasi persisten** — event saat tak ada subscriber hilang.
- **`SerialPorts=1`** ada di DeviceIO, kegunaan tak diketahui (tanpa relay/DI & info wiring).

---

**Intinya:** lever offload paling nyata & aman dimulai hari ini = **A (decode substream H.264)** —
terbukti ada, langsung memangkas beban decode, sekaligus lolos masalah H.265. Sisanya (event-driven,
snapshot ONVIF, metadata sel) menjanjikan tapi **wajib diukur/divalidasi recall** sebelum menggantikan
decode 24/7. Kamera ini **bukan** sensor objek pintar; kecerdasan tetap di server.
