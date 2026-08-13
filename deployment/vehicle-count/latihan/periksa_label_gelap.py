"""Memeriksa label bingkai TERGELAP dengan mata sebelum melatih.

Ini langkah yang dilewati saat membuat v2, dan justru itu yang membuat cacatnya baru
ketahuan oleh pemilik setelah dipasang. Guru (yolo11x) diketahui gemar memberi kotak pada
SILAU lampu di aspal basah; satu-satunya cara tahu apakah itu terjadi adalah melihatnya.

Keluaran: satu lembar montase berisi bingkai paling gelap beserta label yang akan dilatihkan.
"""
import os
import random
from pathlib import Path

import cv2
import numpy as np

DS = Path('/opt/yolo-demo/dataset_multi')
NAMA = ['motor', 'mobil', 'truk', 'bus']
WARNA = [(60, 200, 255), (80, 220, 80), (60, 60, 240), (240, 180, 40)]

berkas = []
for bagian in ('train', 'val'):
    for p in (DS / 'images' / bagian).glob('*.jpg'):
        # nama: c<cam>_<kondisi>_<terang>_<idx>.jpg
        bag = p.stem.split('_')
        try:
            terang = int(bag[2])
        except (ValueError, IndexError):
            continue
        berkas.append((terang, p, DS / 'labels' / bagian / f'{p.stem}.txt'))

berkas.sort(key=lambda x: x[0])
print(f'{len(berkas)} bingkai berlabel; kecerahan {berkas[0][0]} sampai {berkas[-1][0]}')

# 8 paling gelap + 8 acak dari sepertiga tergelap
pilih = berkas[:8]
sepertiga = berkas[:max(1, len(berkas) // 3)]
random.seed(5)
pilih += random.sample(sepertiga, min(8, len(sepertiga)))

SEL = (480, 360)
ubin = []
for terang, gambar, label in pilih:
    img = cv2.imread(str(gambar))
    if img is None:
        continue
    H, W = img.shape[:2]
    n = 0
    if label.exists():
        for baris in label.read_text().strip().splitlines():
            if not baris.strip():
                continue
            k, x, y, w, h = baris.split()
            k = int(k); x, y, w, h = float(x), float(y), float(w), float(h)
            x1, y1 = int((x - w / 2) * W), int((y - h / 2) * H)
            x2, y2 = int((x + w / 2) * W), int((y + h / 2) * H)
            cv2.rectangle(img, (x1, y1), (x2, y2), WARNA[k], 2)
            cv2.putText(img, NAMA[k], (x1, max(12, y1 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.45, WARNA[k], 1, cv2.LINE_AA)
            n += 1
    img = cv2.resize(img, SEL)
    cv2.rectangle(img, (0, 0), (SEL[0], 24), (0, 0, 0), -1)
    cv2.putText(img, f'{gambar.stem[:26]} terang={terang} label={n}', (6, 17),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
    ubin.append(img)

K = 4
baris_img = [np.hstack(ubin[i:i + K]) for i in range(0, len(ubin) - len(ubin) % K, K)]
cv2.imwrite('/tmp/periksa-gelap.jpg', np.vstack(baris_img), [cv2.IMWRITE_JPEG_QUALITY, 88])
print('montase: /tmp/periksa-gelap.jpg')

# ringkasan kelas pada sepertiga tergelap
from collections import Counter
c = Counter()
for terang, _, label in sepertiga:
    if label.exists():
        for baris in label.read_text().strip().splitlines():
            if baris.strip():
                c[NAMA[int(baris.split()[0])]] += 1
print('kelas pada sepertiga tergelap:', dict(c))
