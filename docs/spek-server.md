# Rekomendasi Spesifikasi Server

Patokan untuk menentukan server sebelum memasang sistem: berapa kamera butuh berapa CPU, RAM, dan
disk. **Semua angka dasar di dokumen ini diukur langsung dari server produksi**, bukan diperkirakan
— sumber pengukurannya ada di bagian [Dari mana angkanya](#dari-mana-angkanya).

> Satu hal yang paling sering salah diperkirakan orang: **CPU hampir tidak pernah jadi batasnya.**
> Perekaman berjalan dengan *stream copy* (menyalin paket video apa adanya, tanpa transcode), jadi
> 16 perekam serentak hanya membebani prosesor sekitar 1%. Yang benar-benar habis lebih dulu adalah
> **disk**, lalu **bandwidth**. Belanjakan anggaran ke sana.

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

Rumusnya:

```
GB = jumlah_kamera × jam_retensi × 0,3 GB × 1,15
```

`0,3 GB` adalah pemakaian per kamera per jam hasil pengukuran. `1,15` adalah margin untuk masa
tenggang penghapusan (file baru benar-benar dihapus pada retensi + grace, di mana
grace = maksimum antara 10 menit dan 10% retensi) ditambah cadangan.

| Kamera | Retensi 4 jam | 24 jam | 72 jam (3 hari) | 7 hari |
|---|---|---|---|---|
| 8 | 11 GB | 66 GB | 199 GB | 464 GB |
| 16 | 22 GB | 133 GB | 397 GB | 928 GB |
| 32 | 44 GB | 265 GB | 795 GB | 1,9 TB |
| 64 | 88 GB | 530 GB | 1,6 TB | 3,7 TB |

Tambahkan kapasitas OS, database, dan log di atas angka itu — 20 GB sudah cukup lapang.

⚠️ **Jangan isi disk sampai mepet.** Sistem punya pengaman darurat: kalau sisa disk menyentuh
ambang batas, ia mulai **menghapus rekaman** untuk mengambil ruang. Di produksi ambangnya diset
8 GB dengan target bebas 12 GB. Sisakan minimal 15% kapasitas kosong.

### Kalau bitrate kamera berbeda

`0,3 GB/kamera/jam` setara sekitar **0,7 Mbps**. Itu angka untuk kamera dengan bitrate wajar
(720p–1080p, H.264, dari feed HLS). Untuk kamera bitrate tinggi — 4 Mbps ke atas — kalikan:

```
GB per kamera per jam = bitrate_Mbps × 0,44
```

Yang menentukan ukuran file adalah **bitrate**, bukan resolusi. Pengukuran di produksi menunjukkan
720p, 480p, dan 360p menghasilkan ukuran yang praktis sama karena bitrate-nya memang disetel sama.

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

1. **Ini beban CPU, bukan GPU.** OpenVINO berjalan di prosesor Intel (dan iGPU Intel bila ada).
   Tidak perlu kartu grafis khusus, dan kartu NVIDIA tidak otomatis terpakai.
2. **Beban tumbuh per kamera yang dipantau**, bukan per total kamera. Sepuluh kamera terpasang
   dengan dua yang dipantau hanya membayar dua.

**Angka perencanaan sementara: siapkan 1 core per 2 kamera yang dipantau, di luar tabel di atas.**

> Angka itu **belum diukur di lapangan** — saat dokumen ini ditulis, tidak ada satu pun container
> detektor yang berjalan di server produksi, jadi tidak ada data nyata untuk dikutip. Perlakukan
> sebagai perkiraan kasar untuk anggaran awal, bukan jaminan. Sebelum menjanjikan jumlah kamera
> tertentu ke pelanggan, **nyalakan satu detektor dan ukur sendiri** pemakaian CPU-nya di perangkat
> yang bersangkutan.

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
| Detektor gerakan aktif | **0 container** |

Turunannya: 7,00 GB ÷ 24 kamera = **0,29 GB per kamera per jam**; dari jendela 4 jam keluar angka
0,34. Dibulatkan jadi **0,3 GB** untuk perhitungan. Angka itu cocok silang dengan trafik jaringan
yang terukur (1,89 MB/s ingest ≈ 0,63 Mbps per kamera), jadi dua pengukuran yang berbeda saling
menguatkan.

**Catatan kejujuran:** angka bandwidth dan disk berasal dari 24 kamera yang aktif, bukan 36 yang
terdaftar — sebagian kamera mati di sisi penyedia feed. Untuk perencanaan, hitung pakai jumlah
kamera yang benar-benar akan merekam.

---

## Yang tidak perlu dibeli

- **Kartu grafis khusus** — perekaman tidak memakainya sama sekali, dan detektor memakai OpenVINO
  di CPU/iGPU Intel.
- **CPU banyak core untuk perekaman saja** — 16 perekam serentak = 1% dari 16 core. Kalau tidak
  memakai deteksi gerakan, core tambahan hanya menganggur.
- **RAM besar** — aplikasinya di bawah 700 MB. RAM di atas itu berguna sebagai cache disk, dan
  manfaatnya berhenti bertambah jauh sebelum angka besar.

Uangnya lebih berguna di **disk yang lebih besar** dan **koneksi yang lebih stabil**.
