"""Tambalan: panen khusus SENJA (segmen rekaman terbaru lebih dulu).

panen_multi.py membaca segmen dari yang terlama, jadi kuota per kamera habis di jam terang
dan senja hanya kebagian sisa. Padahal senja justru jam ketika v2 mulai salah kelas -
cahaya turun tapi lampu jalan belum menguasai, dan motor berubah jadi siluet berlampu.
Di sini urutannya dibalik: segmen TERBARU dipanen lebih dulu.
"""
import os
import random
import time
from collections import Counter

import cv2
import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '8')))

REK = '/var/www/rafnet-cctv/recordings'
KOLAM = '/opt/yolo-demo/kolam_multi'
KAMERA = [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28]
COCO2NEW = {3: 0, 2: 1, 7: 2, 5: 3}

SAMPEL_TIAP_DETIK = 3.0
MIN_OBJEK = 1
MAKS_PER_KAMERA = 130
PELUANG_KOSONG = 0.03

random.seed(31)
os.makedirs(KOLAM, exist_ok=True)
penyaring = YOLO('/opt/yolo-demo/yolo11m.pt')

total = 0
t0 = time.time()
for cam in KAMERA:
    d = f'{REK}/camera{cam}'
    if not os.path.isdir(d):
        continue
    # TERBARU lebih dulu - inilah inti tambalan ini
    segmen = sorted((f for f in os.listdir(d) if f.endswith('.mp4')), reverse=True)
    per_jam = Counter()
    diambil = 0
    for nama in segmen:
        if diambil >= MAKS_PER_KAMERA:
            break
        jalur = f'{d}/{nama}'
        jam = time.strftime('%H', time.localtime(os.path.getmtime(jalur)))
        cap = cv2.VideoCapture(jalur)
        fps = cap.get(cv2.CAP_PROP_FPS) or 25
        langkah = max(1, int(fps * SAMPEL_TIAP_DETIK))
        idx = 0
        while diambil < MAKS_PER_KAMERA:
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
            if len(r.boxes) >= MIN_OBJEK or (len(r.boxes) == 0 and random.random() < PELUANG_KOSONG):
                terang = int(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY).mean())
                f_out = f'{KOLAM}/s{cam}_{jam}_{terang:03d}_{nama[:-4]}_{idx:06d}.jpg'
                if not os.path.exists(f_out):
                    cv2.imwrite(f_out, frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
                    diambil += 1
                    per_jam[jam] += 1
                    total += 1
        cap.release()
    print(f'  cam{cam}: {diambil} bingkai senja, per jam {dict(per_jam)} '
          f'(total {total}, {time.time()-t0:.0f}s)', flush=True)

print(f'\nTambalan senja selesai: {total} bingkai dalam {(time.time()-t0)/60:.1f} menit', flush=True)
