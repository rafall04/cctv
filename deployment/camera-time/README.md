# Jam kamera

Kamera CCTV yang jamnya salah membuat rekaman berstempel bohong — dan itu baru ketahuan saat
rekaman dibutuhkan, yang berarti sudah terlambat.

## Apa yang ditemukan (2026-08-26)

Dari 14 kamera milik sendiri, hanya **3** yang mode waktunya `NTP` — dan ketiganya akurat dalam
1 detik. Sebelas sisanya `Manual`, dan **semuanya meleset**:

| keadaan | jumlah |
|---|---|
| berhenti di `1970-01-05` (jam tak pernah di-set) | 5 |
| meleset 4 jam 43 menit | 1 |
| meleset belasan–puluhan detik | 2 |
| jam benar, tapi mode `Manual` (akan hanyut) | 3 |

Kolom server NTP di kamera **sudah terisi** di banyak unit. Jadi masalahnya bukan "belum
diisi" — mode-nya tidak pernah dipindah ke NTP, sehingga kolom itu tidak pernah dibaca.
Bukti paling bersih: id 7 dan id 8 satu subnet, sama-sama menunjuk pool NTP, tapi hanya id 7
yang mode-nya `NTP` — dan hanya id 7 yang jamnya benar.

Dan server ini sendiri **tidak pernah bisa melayani NTP**: ia memakai `systemd-timesyncd`, yang
klien saja. Tidak ada apa pun yang mendengarkan di UDP 123, jadi kamera yang diarahkan ke sini
tidak akan pernah mendapat jawaban. Kini digantikan `chrony` yang melayani di **172.17.11.12**.

## Dua berkas di sini

**`check_camera_time.py`** — pemantau. READ-ONLY. Dijalankan `camera-time-check.timer` tiap jam.
Ia mengawasi dua hal, dan yang kedua lebih penting: **selisih jam** (gejala) dan **mode waktu**
(penyebab, yang terlihat lebih dulu — kamera yang baru kembali ke `Manual` jamnya masih benar
hari ini dan baru meleset nanti). Peringatan Telegram dikirim **hanya saat status berubah**,
termasuk saat pulih; peringatan yang datang tiap jam untuk masalah yang sama akan diabaikan
dalam sehari, dan saat itu ia berhenti berguna.

```bash
python3 check_camera_time.py                 # tabel lengkap
python3 check_camera_time.py --toleransi 30  # lebih ketat
```

**`set_camera_ntp.py`** — konfigurator sekali-jalan lewat ONVIF. Tanpa `--apply` ia hanya
membaca. Setelan lama dicatat ke `/root/camera-ntp-backup.txt` sebelum diubah, dan setiap
perubahan diverifikasi dengan membaca ulang kameranya.

```bash
python3 set_camera_ntp.py                    # lihat dulu, tidak mengubah apa pun
python3 set_camera_ntp.py --apply --only 9   # satu kamera
python3 set_camera_ntp.py --apply            # semua yang API-nya menerima
```

**Zona waktu sengaja tidak disentuh.** Kamera di sini memakai label berbeda untuk offset yang
sama (`KRAT-07:00`, `CST-7:00:00`, `AltaiStandardTime-7`, `GMT+07:00`) — semuanya UTC+7, jadi
angkanya sudah benar. Menyeragamkannya berarti menebak konvensi tanda POSIX tiap firmware, dan
salah tebak menggeser jam berjam-jam. Skrip membaca zona yang ada lalu mengirimkannya kembali.

## Yang tidak bisa dikonfigurasi dari jarak jauh

| kamera | penghalang | jalan keluar |
|---|---|---|
| 1443, 1444 (Dahua) | ONVIF `SetNTP` "not implemented"; port 80 menerima TCP tapi tidak menjawab HTTP | panel web kamera lewat browser |
| 1169 (192.168.12.4) | hanya port 554 terbuka — tidak ada HTTP maupun ONVIF | akses lokal ke perangkatnya |

Ketiganya jamnya **benar** saat ini; yang salah mode-nya, jadi mereka akan hanyut. Pemantau akan
terus menandainya sampai diperbaiki — itu memang gunanya.

## Kalau harus dikembalikan

Setelan lama tiap kamera ada di `/root/camera-ntp-backup.txt` (satu baris per perubahan, memuat
mode, zona, dan daftar server NTP sebelumnya). Untuk chrony: `/root/chrony.conf.bak.*` dan
`/root/timesyncd.conf.bak.*`.

## Catatan untuk yang membaca kode ONVIF-nya

ONVIF di sini **menolak HTTP digest** — ia menuntut WS-Security UsernameToken (nonce + created +
SHA1 digest). Sudah diuji: digest biasa mengembalikan respons kosong tanpa galat, yang mudah
disalahartikan sebagai "kamera tidak menjawab". `GetSystemDateAndTime` terbuka tanpa autentikasi
(karena itu pemantau bisa memeriksa semua kamera), sedangkan `GetNTP`/`SetNTP` menuntutnya.

⚠️ **Firmware Tiandy melaporkan UTC/Local sebagai UPTIME**, bukan jam dinding — muncul sebagai
`1970-01-0x`. Untuk kamera itu, `DateTimeType` yang bisa dipercaya, bukan angka jamnya. Kalau
perlu jam sungguhan, baca stempel yang terbakar di gambar:
`ffmpeg -rtsp_transport tcp -i rtsp://... -ss 4 -frames:v 1 -vf "crop=iw:100:0:0"` — `-ss 4`
wajib, karena bingkai pertama HEVC sering rusak.
