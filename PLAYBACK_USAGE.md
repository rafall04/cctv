# Panduan Penggunaan Playback Video

## 📹 Cara Menggunakan Playback

### Akses Playback
1. Buka: `https://cctv.raf.my.id/playback`
2. Pilih kamera dari dropdown
3. Pilih segment recording yang ingin ditonton

### Kontrol Video
- **Play/Pause**: Klik tombol play di video player
- **Volume**: Adjust volume di video controls
- **Fullscreen**: Klik icon fullscreen di video player
- **Speed**: Hover di kanan atas video untuk ubah kecepatan (0.5x - 2x)

## ⚠️ Batasan Seeking (Skip Video)

### Kenapa Ada Batasan?
Video CCTV memiliki **keyframe interval** yang jarang (setiap 10-30 detik). Saat Anda skip terlalu jauh, browser harus download banyak data untuk menemukan keyframe terdekat, yang menyebabkan **buffering/stuck**.

### Batasan Seeking
- **Maksimal skip: 3 menit per kali**
- Jika Anda coba skip lebih dari 3 menit, sistem akan:
  1. Skip hanya 3 menit dari posisi saat ini
  2. Tampilkan notifikasi kuning di atas video
  3. Beritahu berapa menit lagi ke target

### Contoh Penggunaan

#### ❌ SALAH: Skip langsung 8 menit
```
Posisi: 00:00 → Target: 08:00
Result: Skip ke 03:00, muncul warning
```

#### ✅ BENAR: Skip bertahap
```
Posisi: 00:00 → Klik timeline di 03:00 → Tunggu load
Posisi: 03:00 → Klik timeline di 06:00 → Tunggu load
Posisi: 06:00 → Klik timeline di 08:00 → Selesai!
```

### Tips Seeking Cepat
1. **Gunakan timeline bar** - Klik di timeline untuk skip
2. **Skip bertahap** - Jangan langsung ke akhir, skip 3 menit dulu
3. **Tunggu sebentar** - Biarkan video buffer 1-2 detik sebelum skip lagi
4. **Perhatikan warning** - Notifikasi kuning akan kasih tahu sisa jarak

## 🎯 Notifikasi Warning

### Tampilan Warning
Saat Anda coba skip >3 menit, akan muncul **notifikasi kuning** di atas video:

```
⚠️ Skip dibatasi maksimal 3 menit per kali untuk menghindari buffering.
   Masih 5 menit lagi ke target. Klik lagi untuk lanjut.
```

### Cara Menutup Warning
- **Otomatis**: Hilang setelah 5 detik
- **Manual**: Klik tombol X di kanan atas notifikasi

## 📊 Timeline Visual

### Warna Timeline
- **Hijau**: Segment tersedia
- **Biru**: Segment yang sedang diputar
- **Merah transparan**: Gap/missing recording

### Cara Menggunakan Timeline
1. **Klik segment hijau** untuk pindah ke segment tersebut
2. **Klik di dalam timeline bar** untuk skip dalam segment
3. **Hover di timeline** untuk lihat timestamp

## 🔧 Troubleshooting

### Video Stuck/Buffering
**Penyebab:** Skip terlalu jauh sekaligus

**Solusi:**
1. Refresh halaman (F5)
2. Skip bertahap (max 3 menit per kali)
3. Tunggu 1-2 detik antar skip

### Video Tidak Load
**Penyebab:** Segment belum selesai diproses atau file corrupt

**Solusi:**
1. Coba segment lain
2. Tunggu beberapa menit (segment masih diproses)
3. Hubungi admin jika masalah berlanjut

### Seeking Lambat
**Penyebab:** Network lambat atau file besar (2K resolution)

**Solusi:**
1. Gunakan koneksi internet yang lebih cepat
2. Skip lebih kecil (1-2 menit per kali)
3. Tunggu video buffer sebelum skip lagi

## 💡 Best Practices

### Untuk Viewing Cepat
1. Pilih segment yang tepat dari list
2. Skip 2-3 menit per kali
3. Gunakan speed 1.5x atau 2x untuk review cepat

### Untuk Investigasi Detail
1. Skip ke area yang dicurigai
2. Gunakan speed 0.5x untuk slow motion
3. Pause dan screenshot jika perlu

### Untuk Monitoring Jangka Panjang
1. Gunakan timeline untuk lihat gap recording
2. Fokus ke segment dengan aktivitas (file size besar)
3. Skip segment kosong (file size kecil)

## 📱 Mobile Usage

### Perbedaan di Mobile
- Speed control tidak terlihat (gunakan native video controls)
- Timeline lebih kecil (zoom in untuk akurasi)
- Segment info tersembunyi (tidak block controls)

### Tips Mobile
1. Rotate ke landscape untuk video lebih besar
2. Gunakan native video controls untuk seeking
3. Tap timeline untuk skip (max 3 menit tetap berlaku)

## 🎓 FAQ

### Q: Kenapa tidak bisa skip langsung ke menit ke-9?
**A:** Karena keyframe interval dari kamera CCTV jarang. Skip bertahap mencegah buffering.

### Q: Apakah batasan 3 menit permanen?
**A:** Ya, ini untuk memastikan playback smooth di semua device dan koneksi.

### Q: Bagaimana cara skip cepat tanpa buffering?
**A:** Skip 3 menit → tunggu 1-2 detik → skip 3 menit lagi. Total 6 detik untuk skip 6 menit.

### Q: Apakah bisa download video?
**A:** Saat ini belum ada fitur download. Gunakan screen recording jika perlu.

### Q: Video quality bisa diubah?
**A:** Tidak, video disimpan dalam 1 quality (2K/1440p dari kamera).

## 📞 Support

Jika mengalami masalah yang tidak tercantum di sini:
1. Screenshot error message
2. Catat timestamp dan camera ID
3. Hubungi admin sistem

---

**Last Updated:** 28 Januari 2025
**Version:** 1.0
