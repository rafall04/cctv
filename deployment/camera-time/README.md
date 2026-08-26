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

## Pemasangan: satu perintah, tanpa satu pun alamat diketik

```bash
sudo bash deployment/camera-time/setup.sh
```

Itu saja. Skrip itu memasang chrony, menjadikan server sumber waktu, memasang penjaganya, lalu
menyelaraskan semua kamera. Pemasang tidak perlu tahu apa pun tentang NTP.

**Yang membuatnya bisa dipasang di jaringan mana pun tanpa disetel:**

- **Alamat NTP untuk tiap kamera ditemukan, bukan ditulis.** `ip route get <kamera>` menjawab
  alamat sumber yang dipakai server saat menghubungi kamera itu — persis alamat yang harus
  dituju balik. Benar dengan sendirinya di server satu NIC, banyak NIC, atau di balik gateway.
- **Subnet kamera diturunkan dari daftar kamera di database**, bukan dari daftar yang dirawat
  tangan. Jalankan ulang `setup.sh` sesudah menambah kamera di lokasi baru dan blok chrony
  ditulis ulang lengkap.
- **Merek dideteksi dari apa yang DIJAWAB perangkat**, bukan dari daftar merek. Daftar akan basi
  begitu pelanggan memasang model lain.

## Bagaimana ia menyesuaikan diri

Pemeriksa berkala tidak hanya melapor — ia **membenahi**. Untuk tiap kamera yang mode waktunya
bukan NTP, ia mencoba berurutan dan berhenti pada yang pertama **terbukti** berhasil (terbukti =
dibaca ulang, bukan sekadar dijawab OK):

| urutan | jalur | untuk |
|---|---|---|
| 1 | ONVIF `SetNTP` | jalur standar — Tiandy dan sejenisnya |
| 2 | Hikvision **ISAPI** | firmware yang ONVIF-nya menolak autentikasi |
| 3 | **dorongan waktu** | firmware tanpa klien NTP sama sekali (Longse) |

Urutannya bukan selera: yang di atas membuat kamera mandiri, yang di bawah menuntut server terus
mengurusnya. Jangan pernah menaikkan dorongan ke urutan pertama hanya karena ia paling sering
berhasil.

Akibatnya:

- **Kamera baru** yang ditambahkan operator terkonfigurasi sendiri pada siklus berikutnya —
  tanpa ada yang menjalankan apa pun.
- **Kamera yang kembali ke Manual** sesudah mati listrik atau reset firmware dibenahi lagi tanpa
  diminta.
- **Kamera yang tidak akan pernah bisa ber-NTP** tetap dijaga: jamnya ditulis ulang tiap siklus.
- **Kamera yang tak terjangkau** dilaporkan sebagai tak terjangkau, bukan sebagai alarm —
  tidak terjangkau BUKAN bukti jamnya salah.

## Berkas di sini

**`check_camera_time.py`** — pemantau. READ-ONLY. Dijalankan `camera-time-check.timer` tiap jam.
Ia mengawasi dua hal, dan yang kedua lebih penting: **selisih jam** (gejala) dan **mode waktu**
(penyebab, yang terlihat lebih dulu — kamera yang baru kembali ke `Manual` jamnya masih benar
hari ini dan baru meleset nanti). Peringatan Telegram dikirim **hanya saat status berubah**,
termasuk saat pulih; peringatan yang datang tiap jam untuk masalah yang sama akan diabaikan
dalam sehari, dan saat itu ia berhenti berguna.

```bash
python3 check_camera_time.py                 # tabel lengkap
python3 check_camera_time.py --toleransi 30  # lebih ketat
python3 check_camera_time.py --perbaiki      # sekalian benahi (dipakai timer)
```

**`set_camera_ntp.py`** — konfigurator sekali-jalan lewat ONVIF. Tanpa `--apply` ia hanya
membaca. Setelan lama dicatat ke `/root/camera-ntp-backup.txt` sebelum diubah, dan setiap
perubahan diverifikasi dengan membaca ulang kameranya.

```bash
python3 set_camera_ntp.py                    # lihat dulu, tidak mengubah apa pun
python3 set_camera_ntp.py --apply --only 9   # satu kamera
python3 set_camera_ntp.py --apply            # semua yang API-nya menerima
```

**`discover.py`** — tanya tiap kamera di mana layanan ONVIF-nya dan perangkat apa dia,
lewat WS-Discovery unicast. Dipakai saat sebuah kamera menolak diatur: ia menjawab
"merek/model apa ini sebenarnya" tanpa menebak dari jalur RTSP.


**Zona waktu sengaja tidak disentuh.** Kamera di sini memakai label berbeda untuk offset yang
sama (`KRAT-07:00`, `CST-7:00:00`, `AltaiStandardTime-7`, `GMT+07:00`) — semuanya UTC+7, jadi
angkanya sudah benar. Menyeragamkannya berarti menebak konvensi tanda POSIX tiap firmware, dan
salah tebak menggeser jam berjam-jam. Skrip membaca zona yang ada lalu mengirimkannya kembali.

## Peta per merek — jalur mana untuk perangkat mana

Merek dipastikan lewat **WS-Discovery unicast** ke UDP 3702 tiap kamera, bukan ditebak dari
jalur RTSP-nya. (Tebakan itu sempat menyesatkan: 1443/1444 memakai jalur `/cam/realmonitor`
gaya Dahua, padahal perangkatnya **Longse**.) Multicast tidak melewati gateway, jadi Probe
harus dikirim unicast — `discover.py` melakukannya.

| perangkat | kamera | jalur konfigurasi | hasil |
|---|---|---|---|
| Tiandy TC-C34QN, T5X-39PHX, H43, H2-52PGX | 1, 2, 5, 7, 8, 9, 1168 | ONVIF `SetNTP` + `SetSystemDateAndTime` | mode NTP, menarik dari 172.17.11.12 |
| Hikvision IPC-B121HE-UC | 1170, 1435, 1441, 1442 | **ISAPI** (ONVIF-nya menolak autentikasi) | mode NTP, menarik dari 172.17.11.12 |
| Longse IPC-S41FE, IPC-PS3D-3M0 | 1443, 1444 | ONVIF **dorongan waktu** | server menulis jamnya tiap siklus |
| Yoosee (192.168.12.4) | 1169 | aplikasi Yoosee — tidak ada jalur jaringan | jamnya benar dari cloud vendor |

### Kenapa Longse tidak bisa menarik, dan kenapa itu bukan kemalasan
`SetNTP` dijawab `"This optional method is not implemented"` — baik varian manual maupun
`FromDHCP=true`. Dan `SetSystemDateAndTime` dengan `DateTimeType=NTP` dijawab **OK lalu
DIABAIKAN**: dibaca ulang, mode-nya tetap `Manual`. Firmware-nya memang tidak punya klien NTP.
Perangkat itu juga tidak punya UI web: dari seluruh port TCP hanya `/onvif/device_service` yang
menjawab HTTP, sisanya protokol proprietary di 37777. Jadi mendorong waktu adalah satu-satunya
jalur yang ada — dan konsekuensinya jujur: jam kedua kamera itu hanya seakurat jarak antar
siklus timer (satu jam).

⚠️ **Jawaban `OK` dari ONVIF bukan bukti.** Dua kali di sini panggilan dijawab sukses lalu tidak
melakukan apa-apa. Selalu baca ulang keadaan kameranya sesudah menulis.

### Kenapa 1169 benar-benar buntu
Pemindaian TCP penuh: hanya 554 (RTSP), 5000, dan 10086 terbuka — dua yang terakhir protokol
proprietary yang diam terhadap HTTP maupun ONVIF. WS-Discovery tidak menjawab di port mana pun.
Jalur RTSP-nya `/onvif1` hanya penamaan profil, bukan bukti layanan ONVIF hidup. Kamera Yoosee
disetel lewat aplikasi ponselnya, dan jamnya disinkronkan dari cloud vendor — karena itu justru
benar. Pemantau tetap memeriksanya dan akan melaporkannya sebagai tak terjangkau, bukan sebagai
alarm: tidak terjangkau BUKAN bukti jamnya salah.

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
