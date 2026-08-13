"""Tahap 1 panen BANYAK kamera: saring bingkai berisi kendaraan dari rekaman siang-senja.

Beda dari panen.py (satu kamera):
- Sumbernya 12 kamera Bojonegoro, bukan hanya kamera 15.
- Kuota per kamera DAN per jam, supaya satu kamera ramai atau satu jam padat tidak
  mendominasi bahan latih. Model yang hanya melihat satu simpang akan menghafal simpang itu.
- Kecerahan tiap bingkai dicatat ke nama berkas, supaya nanti bisa dipisah siang/malam
  saat menilai. Itu justru yang hilang pada v2: set validasinya tidak punya satu pun
  bingkai gelap, jadi angkanya tidak pernah bisa melihat kegagalan malam.
"""
import os
import random
import sys
import time
from collections import Counter

import cv2
import numpy as np
import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '6')))

REK = '/var/www/rafnet-cctv/recordings'
KOLAM = '/opt/yolo-demo/kolam_multi'
KAMERA = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28]
COCO2NEW = {3: 0, 2: 1, 7: 2, 5: 3}

SAMPEL_TIAP_DETIK = 5.0
MIN_OBJEK = 1
MAKS_PER_KAMERA = 220
MAKS_PER_JAM = 70            # per kamera per jam
PELUANG_KOSONG = 0.04
LANGKAH_SEGMEN = 2           # ambil tiap segmen ke-2 supaya rentang waktunya lebar

random.seed(11)
os.makedirs(KOLAM, exist_ok=True)
penyaring = YOLO('/opt/yolo-demo/yolo11m.pt')

total = 0
t0 = time.time()
for cam in KAMERA:
    d = f'{REK}/camera{cam}'
    if not os.path.isdir(d):
        print(f'  cam{cam}: tidak ada rekaman', flush=True)
        continue
    segmen = sorted(f for f in os.listdir(d) if f.endswith('.mp4'))[::LANGKAH_SEGMEN]
    per_jam = Counter()
    diambil = 0
    for nama in segmen:
        if diambil >= MAKS_PER_KAMERA:
            break
        jalur = f'{d}/{nama}'
        jam = time.strftime('%H', time.localtime(os.path.getmtime(jalur)))
        if per_jam[jam] >= MAKS_PER_JAM:
            continue
        cap = cv2.VideoCapture(jalur)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        langkah = max(1, int(fps * SAMPEL_TIAP_DETIK))
        idx = 0
        while diambil < MAKS_PER_KAMERA and per_jam[jam] < MAKS_PER_JAM:
            if not cap.grab():
                break
            idx += 1
            if idx % langkah:
                continue
            ok, frame = cap.retrieve()
            if not ok:
                break
            r = penyaring.predict(frame, imgsz=384, classes=list(COCO2NEW), conf=0.20,
                                  agnostic_nms=True, verbose=False)[0]
            n = len(r.boxes)
            if n >= MIN_OBJEK or (n == 0 and random.random() < PELUANG_KOSONG):
                terang = int(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean())
                cv2.imwrite(f'{KOLAM}/c{cam}_{jam}_{terang:03d}_{nama[:-4]}_{idx:06d}.jpg',
                            frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                diambil += 1
                per_jam[jam] += 1
                total += 1
        cap.release()
    print(f'  cam{cam}: {diambil} bingkai, per jam {dict(per_jam)} '
          f'(total {total}, {time.time()-t0:.0f}s)', flush=True)

print(f'\nTAHAP 1 (rekaman siang-senja) selesai: {total} bingkai dalam {(time.time()-t0)/60:.1f} menit',
      flush=True)
