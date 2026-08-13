# Ronda Digital — runtime detektor

Perangkat pendukung untuk halaman admin **Ronda Digital** (`/admin/ronda`). Panel dan API-nya
sudah ada di backend sejak lama; berkas-berkas di folder inilah yang membuat tombolnya benar-benar
bisa menjalankan sesuatu.

| Berkas | Isi |
|---|---|
| `motion.py` | Detektor: baca RTSP → MOG2 → konfirmasi YOLO (OpenVINO) → Telegram. Satu proses per kamera. |
| `Dockerfile` | Image `motion-ai:latest` — 1,4 GB di disk, tanpa torch. |
| `ekspor-model.sh` | Ekspor `yolo11n` → `yolo11n320_openvino_model`, sekali saja. |
| `pasang.sh` | Menjalankan ketiganya. Idempoten. **Tidak** menyalakan detektor. |

## Memasang

```bash
bash deployment/ronda/pasang.sh          # bawaan /opt/yolo-poc
```

Setelah itu halaman Ronda Digital berhenti menampilkan spanduk "belum terpasang" dan tombol
**+ Tambah Kamera** muncul. Menambahkan kamera dari panel itulah yang membuat container detektor
(`motion-<slug>`) berjalan.

Satu hal masih perlu diisi manusia: **token bot Telegram**, lewat Pengaturan Telegram di panel.
Tanpa token, detektor berjalan dan merekam kejadian tetapi tidak bisa mengirim peringatan, jadi
`createDetector` menolak dengan pesan yang jelas alih-alih diam-diam membuat kamera yang bisu.

## Biaya CPU — baca sebelum menambah kamera

Tiap detektor dibatasi 2 core (`--cpus 2`), tetapi yang benar-benar terpakai jauh lebih kecil.
Terukur di produksi 13 Agustus 2026 pada kamera jembatan Sosrodilogo, siang hari lalu lintas
ramai: **27,7% dari satu core dan 162 MiB RAM** (`proc_w=960`, `target_fps=5`, `imgsz=320`, dan
`GATE_COOLDOWN=5` — dua kali lebih sering dari bawaannya, jadi angka ini konservatif).

Yang belum terukur: malam hari (derau sensor menaikkan luas gerak, jadi YOLO lebih sering
terpicu) dan hujan. Perencanaan sekarang **1 core per 3 kamera** —
lihat [docs/spek-server.md](../../docs/spek-server.md). Tetap **nyalakan satu kamera dulu,
ukur, baru tambah** sebelum menjanjikan jumlah kamera ke pelanggan.

## Kontrak yang menghubungkan tiga berkas

Setelan mengalir lewat tiga tempat yang harus sepakat. Kalau salah satu tertinggal, panel akan
tampak menyimpan padahal detektor tidak pernah membacanya:

1. `backend/services/rondaDetectorService.js` → `#runArgs()` mengirim nilai awal sebagai env var
   saat container dibuat.
2. `backend/services/rondaConfigService.js` → `EDITABLE` menentukan kunci mana yang boleh diubah
   panel saat berjalan; `STRUCTURAL` menandai yang baru berlaku setelah dinyalakan ulang.
3. `motion.py` → membaca ulang `CONFIG_PATH` tiap `CONFIG_EVERY` (15) detik untuk kunci EDITABLE.

Yang ditulis detektor ke `OUT_DIR`, dan siapa yang membacanya:

| Berkas | Pembaca |
|---|---|
| `status.json` | `rondaConfigService.statusOf()` — menentukan lampu online/offline & kejadian hari ini. |
| `latest.jpg` | `GET /api/admin/ronda/cameras/:name/preview` — latar editor zona. |
| `snaps/*.jpg` | Arsip cuplikan kejadian (dipangkas `RETENTION_DAYS` / `MAX_SNAPS`). |
| `events.jsonl` | Riwayat kejadian (dipangkas `MAX_EVENTS`). |

## Catatan teknis

- **OpenVINO langsung, bukan ultralytics.** Tidak ada impor torch di tiap container, dan image
  berhenti di 1,4 GB. Harganya: letterbox dan NMS ditulis tangan di `motion.py` — periksa bagian
  itu lebih dulu kalau modelnya diganti. (Catatan ukuran: `docker image inspect .Size` melaporkan
  364 MB untuk image ini, tetapi pemakaian disk sebenarnya 1,4 GB menurut `docker system df -v`.
  Pakai yang kedua saat menghitung kapasitas disk.)
- **Gerak dulu, YOLO belakangan.** YOLO hanya dipanggil setelah gerakan bertahan `CONFIRM` detik,
  dan paling cepat tiap `GATE_COOLDOWN` detik. Menjalankannya tiap frame akan menabrak ffmpeg.
- **Bayangan dibuang.** MOG2 menandai bayangan dengan nilai 127; ambang 200 menyingkirkannya,
  sehingga bayangan panjang sore hari tidak dihitung sebagai gerakan.
- **Perubahan global diabaikan.** Bila area gerak melebihi `GLOBAL_FRAC` (0,6) dari bingkai, itu
  lampu menyala atau auto-exposure kamera, bukan orang — diabaikan. Peringatan palsu semacam ini
  yang membuat pemilik berhenti membaca notifikasi.
