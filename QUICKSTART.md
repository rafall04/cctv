# Panduan Cepat — Pasang & Pakai (untuk Pembeli)

Satu jalur yang direkomendasikan, dari nol sampai bisa login. Untuk detail keamanan lihat
[INSTALLATION_SECURITY.md](INSTALLATION_SECURITY.md); untuk ukuran server lihat [docs/spek-server.md](docs/spek-server.md).

> Ganti `<REPO_URL>` dengan alamat repositori yang Anda terima, dan `<DOMAIN>` dengan domain Anda
> (boleh dikosongkan / pakai IP saja saat awal).

---

## 1. Prasyarat

- Server **Ubuntu/Debian** (VPS atau lokal), akses **root/sudo**.
- **Node.js 20+** (installer akan memasang bila belum ada).
- Domain (opsional; bisa akses via IP dulu).

## 2. Pasang (installer interaktif)

```bash
git clone <REPO_URL> cctv
cd cctv
sudo bash deployment/install.sh
```

Installer akan: memasang dependensi (ffmpeg, MediaMTX, PM2), **membangkitkan secret unik**,
membuat `.env`, menyiapkan database, membangun frontend, dan menjalankan layanan.

## 3. Ambil password admin awal → login

Password admin **dibuat acak** saat instalasi dan disimpan di berkas berikut (juga tampil di
ringkasan akhir installer):

```bash
cat backend/data/INITIAL_ADMIN_PASSWORD.txt
```

Buka `http://<DOMAIN-atau-IP>/` → login **admin** dengan password itu → **ganti password** dari
menu Profil → lalu **hapus** berkas tersebut.

> Lupa / kehilangan password kapan pun?
> ```bash
> cd backend && npm run reset-admin
> ```
> (mencadangkan DB dulu, lalu memberi password baru.)

## 4. Pakai

- **Tambah kamera**: menu **Kamera** → isi RTSP/HLS, lokasi, koordinat.
- **Branding** (nama, warna, logo, kontak): menu **Pengaturan → Branding** — tersimpan di database,
  **aman saat update** (lihat bagian Kustomisasi di bawah).
- **Arsip ke Telegram** (opsional, cadangan rekaman off-site): menu **Arsip ke Telegram**.

---

## 5. Update (aman untuk data Anda)

```bash
bash deployment/update.sh
```

Yang dijamin **AMAN & tidak hilang** saat update: database, rekaman, thumbnail, logo/branding,
file `.env`, dan konfigurasi — semuanya di luar kendali git (lihat `.gitignore`). Update juga
**mencadangkan DB** sebelum migrasi dan mencetak cara **rollback** bila ada masalah.

> ⚠️ Jangan mengedit **file kode yang dilacak git** untuk kustomisasi — update memakai
> `git reset --hard` sehingga edit kode akan tertimpa. Semua kustomisasi normal (branding, kamera,
> setelan) dilakukan lewat **UI admin** dan tersimpan di database.

## 6. Operasi harian

```bash
bash deployment/status.sh        # status layanan
bash deployment/logs.sh          # lihat log backend (recorder / mediamtx sebagai argumen)
bash deployment/healthcheck.sh   # cek menyeluruh: proses, /health, ffmpeg, disk
bash deployment/start.sh         # start semua
bash deployment/stop.sh          # stop semua
```

## 7. Kustomisasi tahan-update

Lakukan dari **UI admin** (tersimpan di database, tidak tertimpa update):
- Nama, tagline, warna, kontak WhatsApp, watermark, teks landing.
- **Logo, favicon, gambar share (OG)** — unggah dari **Pengaturan → Branding**.
- Kamera, area, token playback, arsip Telegram, sponsor/iklan.

## 8. Masalah umum

| Gejala | Solusi |
|---|---|
| Tidak tahu password admin | `cat backend/data/INITIAL_ADMIN_PASSWORD.txt` — atau `cd backend && npm run reset-admin` |
| Port sudah dipakai | ubah `PORT` di `backend/.env`, lalu `bash deployment/start.sh` |
| Video live blank / gagal | pastikan `PUBLIC_STREAM_BASE_URL` **kosong** (default 1-origin) kecuali Anda sengaja split-origin |
| Rekaman/thumbnail tak jalan | `ffmpeg -version` harus ada; `bash deployment/healthcheck.sh` |
| Update berhenti | jalankan `bash deployment/healthcheck.sh`; ikuti blok **rollback** yang dicetak update.sh |
| Cek kesehatan menyeluruh | `bash deployment/healthcheck.sh` |
