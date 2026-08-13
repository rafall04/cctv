# Pipeline latihan model hitung kendaraan

Model yang dipakai penghitung dilatih dari rekaman kamera-kamera itu sendiri, bukan dari COCO
umum. Berkas di sini adalah pipeline-nya, urut dari kiri ke kanan:

| Urutan | Berkas | Tugas |
|---|---|---|
| 1 | `panen_multi.py` | Saring bingkai berisi kendaraan dari rekaman 12 kamera (siang→senja). |
| 2 | `panen_senja.py` | Tambalan: ulangi dari segmen TERBARU supaya senja tidak kalah kuota. |
| 3 | `label_multi.py` | Labeli dengan guru `yolo11x@512+TTA`, bangun dataset + val terpisah per kondisi. |
| 4 | `periksa_label_gelap.py` | **Lihat** label tergelap sebelum melatih. Jangan dilewati. |
| 5 | `latih_multi.py` | Latih murid `yolo11s` menirukan guru. |

Bingkai malam ditangkap terpisah, langsung dari siaran, karena rekaman hanya bertahan ~4 jam:

```bash
ffmpeg -i "$URL" -vf fps=1/3 -t 1560 -q:v 3 /opt/yolo-demo/kolam_malam/<id>/m%04d.jpg
```

## Kenapa pipeline ini dibangun ulang untuk banyak kamera (13 Agustus 2026)

Model sebelumnya (`kamera15-v2.pt`) dilatih dari satu kamera dan **membuang 443 bingkai gelap**.
Hasilnya menang di semua angka validasi — mAP50-95 0,629 vs 0,602 — lalu gagal di lapangan:
setelah senja ia menandai motor sebagai mobil, dan pemiliknya yang menemukan, bukan pengujinya.

Sebabnya bukan modelnya, melainkan **set validasinya**: karena bingkai gelap dibuang dari
train DAN val, angka validasi itu secara harfiah tidak pernah mengukur malam.

Tiga aturan yang lahir dari situ, dan alasan pipeline ini berbentuk begini:

1. **Jangan menyaring keluar kondisi sulit, lalu menilai dengan sisanya.** Set uji yang
   dibersihkan dari kasus sulit tidak bisa membuktikan apa pun tentang kasus sulit.
2. **Nilai per kondisi, bukan satu angka gabungan** — `data_siang.yaml`, `data_senja.yaml`,
   `data_malam.yaml` dibangun berdampingan dengan `data.yaml`. Satu rata-rata bisa terlihat
   naik sementara separuh kondisi memburuk.
3. **Lihat labelnya sebelum melatih.** Guru gemar memberi kotak pada silau lampu di aspal
   basah; hanya mata yang bisa menangkap itu. `periksa_label_gelap.py` ada untuk ini.

## Catatan setelan

- `freeze=10` (tulang punggung dibekukan) — di CPU inilah yang membuat latihan mungkin sama sekali.
- **`fliplr=0.5` untuk model banyak kamera.** Pada model satu kamera nilainya 0 dan itu benar:
  kamera tetap, jadi mengajari cerminan hanya membuang kapasitas. Begitu bahannya 12 sudut
  pandang, aturan itu berbalik.
- `imgsz=448`. Lebih besar TIDAK lebih baik di kamera CCTV — 384–512 terukur mengalahkan 640.
- Bobot awal dari `yolo11s.pt` COCO, bukan melanjutkan model lama yang sudah condong ke siang.
