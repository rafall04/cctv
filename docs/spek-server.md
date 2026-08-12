# Rekomendasi Spesifikasi Server

Patokan untuk menentukan server sebelum memasang sistem: berapa kamera butuh berapa CPU, RAM, dan
disk. Angkanya berasal dari pengukuran, bukan perkiraan — tapi **baca dulu dari pengukuran yang
mana**, karena tiap angka punya cakupan berbeda dan dua di antaranya sempat salah besar. Rinciannya
di [Dari mana angkanya](#dari-mana-angkanya).

> Satu hal yang paling sering salah diperkirakan orang: **CPU hampir tidak pernah jadi batasnya.**
> Perekaman berjalan dengan *stream copy* (menyalin paket video apa adanya, tanpa transcode), jadi
> 25 perekam serentak hanya menghabiskan **12,6% dari satu inti** — 0,8% dari kapasitas mesin
> 16-inti. Yang benar-benar habis lebih dulu adalah **disk**, lalu **bandwidth**. Belanjakan
> anggaran ke sana.

⚠️ **Kolom vCPU di tabel di bawah adalah ruang lega, bukan kebutuhan terukur.** Dari angka di atas,
64 kamera hanya butuh ±0,3 inti untuk merekam — jauh di bawah 8 vCPU yang direkomendasikan. Selisih
itu disediakan untuk melayani penonton, membuat thumbnail, health-check, dan **mengemas ulang RTSP
lewat MediaMTX**. Bagian terakhir itu **belum pernah terukur**: pada 12 Agustus 2026 MediaMTX di
produksi melaporkan `itemCount: 0` — nol path aktif, karena seluruh 36 kamera di sana adalah HLS
eksternal, bukan RTSP milik sendiri. Padahal RTSP justru jalur yang dipakai pembeli yang memasang
kamera sendiri. Jangan menurunkan angka vCPU di tabel sebelum jalur itu diukur pada skala nyata.

---

## Ringkasan cepat

Tanpa deteksi gerakan (perekaman + tayang langsung saja):

| Jumlah kamera | vCPU | RAM | Disk (di luar OS) |
|---|---|---|---|
| sampai 8 | 2 | 4 GB | lihat tabel disk |
| sampai 16 | 2 | 4 GB | lihat tabel disk |
| sampai 32 | 4 | 8 GB | lihat tabel disk |
| sampai 64 | 8 | 16 GB | lihat tabel disk |
| sampai 128 | 16 | 16 GB | lihat tabel disk |

Sistem aplikasinya sendiri ringan: backend 135 MB, perekam 444 MB, MediaMTX 7 MB — total di bawah
700 MB RAM apa pun jumlah kameranya. RAM di tabel itu untuk *page cache* disk, yang membuat
penulisan rekaman tidak tersendat.

**Disk selalu jadi penentu.** Tentukan retensinya dulu, baru hitung disknya.

---

## Menghitung disk

> ⚠️ **Angka disk di dokumen ini pernah salah 2,5–5× ke arah yang berbahaya, dan dikoreksi
> 2026-08-12.** Versi lama memakai `0,3 GB/kamera/jam` yang diukur dari **feed HLS publik yang sudah
> diturunkan mutunya** (±0,7 Mbps) — bukan kamera 1080p sungguhan. Kamera nyata jauh lebih boros.
> Salah ke arah ini fatal: disk kekecilan → penuh → pengaman darurat mulai **menghapus rekaman**.
> Kalau menemukan `0,3 GB` di materi lain, itu sisa versi lama.

Rumusnya:

```
GB = jumlah_kamera × jam_retensi × GB_per_jam × 1,15
GB_per_jam       = bitrate_Mbps × 0,44
```

`1,15` adalah margin untuk masa tenggang penghapusan (file benar-benar dihapus pada retensi + grace,
di mana grace = maksimum antara 10 menit dan 10% retensi) ditambah cadangan.

**Yang menentukan ukuran file adalah bitrate, bukan resolusi dan bukan jumlah kamera.** Dua kamera
1080p yang dari luar terlihat sama bisa berbeda hampir dua kali lipat hanya karena codec-nya.
Patokan dari instalasi berkamera sungguhan:

| Codec | Per 10 menit | Per kamera per jam | Setara bitrate |
|---|---|---|---|
| H.265 | 130–150 MB | **±0,8 GB** | ±1,9 Mbps |
| H.264 | 230–250 MB | **±1,4 GB** | ±3,2 Mbps |
| Feed HLS publik (diturunkan mutunya) | ±58 MB | ±0,34 GB | ±0,8 Mbps |

Batas bawah tabel di bawah = H.265, batas atas = H.264. Baris `4 jam` ada karena itu retensi yang
dipakai produksi sekarang.

| Kamera | 4 jam | 24 jam | 3 hari | 7 hari |
|---|---|---|---|---|
| 8 | 29 – 52 GB | 180 – 310 GB | 530 – 930 GB | 1,2 – 2,2 TB |
| 16 | 59 – 103 GB | 350 – 620 GB | 1,1 – 1,9 TB | 2,5 – 4,3 TB |
| 32 | 118 – 206 GB | 710 GB – 1,2 TB | 2,1 – 3,7 TB | 4,9 – 8,7 TB |
| 64 | 235 – 412 GB | 1,4 – 2,5 TB | 4,2 – 7,4 TB | 9,9 – 17,3 TB |

Tambahkan kapasitas OS, database, dan log di atas angka itu — 20 GB sudah cukup lapang.

⚠️ **Jangan isi disk sampai mepet.** Sistem punya pengaman darurat: kalau sisa disk menyentuh
ambang batas, ia mulai **menghapus rekaman** untuk mengambil ruang. Di produksi ambangnya diset
8 GB dengan target bebas 12 GB. Sisakan minimal 15% kapasitas kosong.

### Yang membuat angkanya membengkak

Semua faktor di bawah menaikkan bitrate, dan bitrate-lah yang menentukan ukuran file. Tidak satu pun
punya pengali pasti — sebutkan sebagai arah, jangan sebagai rumus:

- **Resolusi / megapixel.** Kamera 4 MP menyimpan jauh lebih banyak daripada 2 MP pada pengaturan
  mutu yang sama; 8 MP lebih besar lagi. Ini faktor terbesar setelah codec.
- **Codec.** H.264 hampir dua kali H.265 untuk gambar yang setara.
- **Frame rate.** 25 fps terhadap 15 fps menambah ukuran secara nyata.
- **Keramaian pemandangan.** Bitrate kamera umumnya variabel: jalan ramai menghasilkan file jauh
  lebih besar daripada gudang yang sepi — dari kamera yang sama persis.
- **Malam hari / mode inframerah.** Bintik-bintik (noise) pada gambar malam sangat mahal untuk
  dimampatkan. Banyak instalasi memakai lebih banyak ruang di malam hari daripada siang.

**Aturan aman: kalikan hasil hitungan dengan 1,5–2×.** Disk yang kebesaran hanya membuang sedikit
uang; disk yang kekecilan membuat pengaman darurat menghapus rekaman pelanggan.

**Sebelum membeli disk, ukur sendiri.** Cara paling jujur: pasang satu kamera dengan pengaturan
yang akan dipakai, rekam satu jam, lalu lihat ukuran berkasnya. Satu pengukuran nyata mengalahkan
seluruh tabel di atas.

---

## Jaringan

- **Masuk (ingest):** ±0,7 Mbps per kamera. 32 kamera ≈ 23 Mbps yang harus stabil 24 jam.
- **Keluar (penonton):** ±0,7 Mbps per penonton per kamera yang sedang dibuka. Sepuluh orang
  menonton bersamaan ≈ 7 Mbps.

Ingest tidak boleh putus-putus. Koneksi 100 Mbps simetris nyaman sampai sekitar 64 kamera; yang
lebih penting daripada angka besarnya adalah **kestabilan** — kamera yang feed-nya tersendat akan
memicu perekam mengulang terus.

---

## Deteksi gerakan — dihitung terpisah

Deteksi gerakan **tidak** memakai jalur yang sama dengan perekaman. Ia berjalan sebagai satu
container Docker per kamera, memuat model YOLO11-nano pada resolusi 320 piksel lewat OpenVINO.

Dua hal yang perlu diluruskan sebelum belanja perangkat:

1. **Sebagaimana dikonfigurasi sekarang, ini beban CPU — bukan GPU.** OpenVINO berjalan di prosesor
   Intel (dan iGPU Intel bila ada), jadi kartu NVIDIA yang dipasang begitu saja **tidak** akan
   terpakai. Itu fakta tentang konfigurasi saat ini, **bukan** anjuran untuk tidak pernah memakai
   akselerator: untuk kamera yang dipantau banyak atau deteksi yang harus cepat, perangkat
   pemercepat adalah jawaban yang benar — tapi menuju ke sana berarti mengganti runtime inferensinya,
   bukan sekadar menancapkan kartu. Jangan menyarankan pelanggan membeli GPU sebelum perubahan itu
   dikerjakan, dan jangan pula menyarankan mereka tidak akan pernah membutuhkannya.
2. **Beban tumbuh per kamera yang dipantau**, bukan per total kamera. Sepuluh kamera terpasang
   dengan dua yang dipantau hanya membayar dua.

**Angka perencanaan sementara: siapkan 1 core per 2 kamera yang dipantau, di luar tabel di atas.**

> Angka itu **belum diukur di lapangan**, dan tidak bisa diukur dulu: per 12 Agustus 2026 detektornya
> **belum terpasang sama sekali** di server produksi — tidak ada image `motion-ai`, tidak ada
> direktori `/opt/yolo-poc`, tidak ada berkas model, dan tidak pernah ada container detektor yang
> berjalan. Kodenya ada di backend (`services/rondaDetectorService.js`), perangkat pendukungnya
> belum. Jadi angka di atas adalah turunan dari ukuran model, bukan hasil pengukuran.
>
> Perlakukan sebagai perkiraan kasar untuk anggaran awal, bukan jaminan. Sebelum menjanjikan jumlah
> kamera tertentu ke pelanggan, **pasang detektornya, nyalakan satu, lalu ukur sendiri** pemakaian
> CPU-nya di perangkat yang bersangkutan.

---

## Contoh pemilihan

**Toko / rumah — 4 kamera, rekaman 3 hari, tanpa deteksi**
2 vCPU · 4 GB RAM · 120 GB SSD. (4 × 72 × 0,3 × 1,15 = 99 GB + OS.)

**Kantor / ruko — 16 kamera, rekaman 24 jam, 4 kamera dideteksi**
4 vCPU (2 untuk sistem + 2 untuk detektor) · 8 GB RAM · 200 GB SSD.

**Operator layanan — 64 kamera, rekaman 24 jam, tanpa deteksi**
8 vCPU · 16 GB RAM · 640 GB SSD, koneksi 100 Mbps simetris.

---

## Dari mana angkanya

Diukur langsung di server produksi pada **12 Agustus 2026**:

| | |
|---|---|
| Perangkat | Intel Xeon E5-2695 v4 @ 2,10 GHz · 16 vCPU · 16 GB RAM · disk 146 GB |
| Sistem | Ubuntu 22.04, Node 20, PM2 (backend cluster + perekam + MediaMTX) |
| Kamera terdaftar | 36, retensi 4 jam seluruhnya |
| Kamera benar-benar merekam saat diukur | 24 |
| Proses ffmpeg berjalan | 16 |
| **Beban CPU** | **load average 0,09 dari 16 core — praktis menganggur** |
| RAM terpakai | 1,26 GB dari 16 GB (sisanya cache) |
| Rekaman 1 jam terakhir | 121 segmen dari 24 kamera = **7,00 GB** |
| Rekaman 4 jam terakhir | 676 segmen = **37,96 GB** |
| Rata-rata satu segmen | ±58 MB (segmen 10 menit) |
| Total rekaman di disk | 42 GB (pada retensi 4 jam) |
| Total CPU seluruh ffmpeg | **12,6% dari satu inti** (25 proses) |
| Path aktif MediaMTX | **0** — jalur RTSP tidak teruji sama sekali |
| Detektor gerakan aktif | **0 container**, dan perangkatnya belum terpasang |

Turunannya: 7,00 GB ÷ 24 kamera = **0,29 GB per kamera per jam**; dari jendela 4 jam keluar angka
0,34. Dibulatkan jadi **0,3 GB** untuk perhitungan. Angka itu cocok silang dengan trafik jaringan
yang terukur (1,89 MB/s ingest ≈ 0,63 Mbps per kamera), jadi dua pengukuran yang berbeda saling
menguatkan.

**Catatan kejujuran:** angka bandwidth dan disk berasal dari 24 kamera yang aktif, bukan 36 yang
terdaftar — sebagian kamera mati di sisi penyedia feed. Untuk perencanaan, hitung pakai jumlah
kamera yang benar-benar akan merekam.

---

## Yang tidak perlu dibeli

- **Kartu grafis khusus, bila hanya merekam** — perekaman tidak memakainya sama sekali, dan detektor
  seperti dikonfigurasi sekarang juga tidak. Untuk deteksi berskala besar itu cerita lain; lihat
  catatan di bagian deteksi gerakan sebelum menyimpulkan.
- **CPU banyak core untuk perekaman saja** — 16 perekam serentak = 1% dari 16 core. Kalau tidak
  memakai deteksi gerakan, core tambahan hanya menganggur.
- **RAM besar** — aplikasinya di bawah 700 MB. RAM di atas itu berguna sebagai cache disk, dan
  manfaatnya berhenti bertambah jauh sebelum angka besar.

Uangnya lebih berguna di **disk yang lebih besar** dan **koneksi yang lebih stabil**.
