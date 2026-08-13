"""Mencari setelan GURU yang benar-benar melihat motor di malam hari.

Latar belakang: pelabelan pertama memakai conf 0.40 untuk bingkai gelap, dengan alasan
menahan silau lampu. Hasilnya terbalik dari yang diharapkan - silau memang berkurang, tetapi
MOTOR ikut hilang, karena di malam hari motor justru objek berkeyakinan paling rendah
(sering hanya satu titik lampu). Sebaran label malam jadi mobil 1.161 lawan motor 476,
padahal siang hari motor yang mendominasi. Melatih dengan label itu akan mengajarkan
persis kesalahan yang ingin diperbaiki.

Skrip ini menyapu beberapa kombinasi imgsz/conf/TTA pada bingkai gelap yang sama, menghitung
motor yang ditemukan, dan menyimpan montase supaya hasilnya bisa DILIHAT, bukan hanya dihitung.
"""
import os
from collections import Counter
from pathlib import Path

import cv2
import numpy as np
import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '10')))

DS = Path('/opt/yolo-demo/dataset_multi')
COCO2NEW = {3: 'motor', 2: 'mobil', 7: 'truk', 5: 'bus'}
WARNA = {'motor': (60, 200, 255), 'mobil': (80, 220, 80), 'truk': (60, 60, 240), 'bus': (240, 180, 40)}

SETELAN = [
    ('512/0.40/TTA  (dipakai tadi)', 512, 0.40, True),
    ('512/0.20/TTA', 512, 0.20, True),
    ('640/0.20/TTA', 640, 0.20, True),
    ('960/0.20/TTA', 960, 0.20, True),
    ('960/0.12/TTA', 960, 0.12, True),
    ('1280/0.12/TTA', 1280, 0.12, True),
]

# bingkai tergelap yang benar-benar berisi lalu lintas
kandidat = []
for bagian in ('train', 'val'):
    for p in (DS / 'images' / bagian).glob('*.jpg'):
        bag = p.stem.split('_')
        try:
            terang = int(bag[2])
        except (ValueError, IndexError):
            continue
        if terang <= 90:
            kandidat.append((terang, p))
kandidat.sort(key=lambda x: x[0])
contoh = [p for _, p in kandidat[:60]][::7][:8]
print(f'{len(kandidat)} bingkai gelap; menguji {len(contoh)} di antaranya\n')

guru = YOLO('/opt/yolo-demo/yolo11x.pt')
ringkas = {}
gambar_per_setelan = {}

for nama, imgsz, conf, tta in SETELAN:
    c = Counter()
    hasil_gambar = []
    for p in contoh:
        img = cv2.imread(str(p))
        r = guru.predict(img, imgsz=imgsz, classes=list(COCO2NEW), conf=conf,
                         augment=tta, agnostic_nms=True, verbose=False)[0]
        vis = img.copy()
        for cl, sk, b in zip(r.boxes.cls.tolist(), r.boxes.conf.tolist(), r.boxes.xyxy.tolist()):
            k = COCO2NEW[int(cl)]
            c[k] += 1
            x1, y1, x2, y2 = [int(v) for v in b]
            cv2.rectangle(vis, (x1, y1), (x2, y2), WARNA[k], 2)
            cv2.putText(vis, f'{k} {sk:.2f}', (x1, max(11, y1 - 4)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.4, WARNA[k], 1, cv2.LINE_AA)
        hasil_gambar.append(cv2.resize(vis, (400, 300)))
    ringkas[nama] = c
    gambar_per_setelan[nama] = hasil_gambar
    tot = sum(c.values())
    print(f'  {nama:30s} total {tot:3d} | motor {c["motor"]:3d} mobil {c["mobil"]:3d} '
          f'truk {c["truk"]:3d} bus {c["bus"]:3d}', flush=True)

# Montase: satu BARIS per setelan, 4 bingkai pertama
baris = []
for nama, _, _, _ in SETELAN:
    strip = np.hstack(gambar_per_setelan[nama][:4])
    cv2.rectangle(strip, (0, 0), (strip.shape[1], 22), (0, 0, 0), -1)
    cv2.putText(strip, nama, (6, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    baris.append(strip)
cv2.imwrite('/tmp/uji-guru-malam.jpg', np.vstack(baris), [cv2.IMWRITE_JPEG_QUALITY, 88])
print('\nmontase: /tmp/uji-guru-malam.jpg')
