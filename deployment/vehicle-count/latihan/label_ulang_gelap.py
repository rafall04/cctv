"""Melabeli ULANG bingkai gelap dengan setelan guru yang terbukti melihat motor.

Kenapa perlu: pelabelan pertama memakai conf 0.40 untuk bingkai gelap dengan maksud menahan
silau. Maksudnya benar, akibatnya tidak: pada 8 bingkai gelap yang sama setelan itu hanya
menemukan 2 motor, sementara 640/0.20/TTA menemukan 9. Sebaran label malam pun jadi terbalik
dari kenyataan - mobil 1.161 lawan motor 476, padahal siang hari motor yang mendominasi.

Kenapa 640/0.20 dan bukan 960/0.12 yang menemukan motor paling banyak (16): pada 960/0.12
sebagian tambahannya adalah kotak "motor" raksasa di atas SILAU lampu, bukan kendaraan.
Melatih dengan itu mengajarkan "silau = motor", yaitu kesalahan yang bentuknya sama dengan
yang sedang diperbaiki, hanya berpindah kelas. 640/0.20 memberi motor tanpa artefak itu.

Hanya berkas dengan kecerahan di bawah AMBANG yang disentuh; label siang dibiarkan.
"""
import os
import shutil
from collections import Counter
from pathlib import Path

import cv2
import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '10')))

DS = Path('/opt/yolo-demo/dataset_multi')
COCO2NEW = {3: 0, 2: 1, 7: 2, 5: 3}
NAMA = ['motor', 'mobil', 'truk', 'bus']

AMBANG_TERANG = 105          # di bawah ini dianggap butuh setelan gelap
IMGSZ, CONF, TTA = 640, 0.20, True

guru = YOLO('/opt/yolo-demo/yolo11x.pt')

sasaran = []
for bagian in ('train', 'val', 'val_siang', 'val_senja', 'val_malam'):
    d = DS / 'images' / bagian
    if not d.is_dir():
        continue
    for p in d.glob('*.jpg'):
        bag = p.stem.split('_')
        try:
            terang = int(bag[2])
        except (ValueError, IndexError):
            continue
        if terang < AMBANG_TERANG:
            sasaran.append((bagian, p, terang))

print(f'{len(sasaran)} berkas gelap akan dilabeli ulang '
      f'(dari {sum(1 for _ in (DS / "images/train").glob("*.jpg"))} train)', flush=True)

sebelum = Counter()
sesudah = Counter()
# hitung sebaran lama dulu
for bagian, p, _ in sasaran:
    lab = DS / 'labels' / bagian / f'{p.stem}.txt'
    if lab.exists():
        for baris in lab.read_text().strip().splitlines():
            if baris.strip():
                sebelum[NAMA[int(baris.split()[0])]] += 1

# Satu bingkai bisa muncul di dua tempat (val + val_malam). Dilabeli sekali, ditulis ke semua.
selesai = {}
for i, (bagian, p, terang) in enumerate(sasaran):
    if p.name in selesai:
        baris = selesai[p.name]
    else:
        img = cv2.imread(str(p))
        if img is None:
            continue
        r = guru.predict(img, imgsz=IMGSZ, classes=list(COCO2NEW), conf=CONF,
                         augment=TTA, agnostic_nms=True, verbose=False)[0]
        baris = []
        for box, cl in zip(r.boxes.xywhn.tolist(), r.boxes.cls.tolist()):
            k = COCO2NEW[int(cl)]
            baris.append(f'{k} {box[0]:.6f} {box[1]:.6f} {box[2]:.6f} {box[3]:.6f}')
        selesai[p.name] = baris
        for b in baris:
            sesudah[NAMA[int(b.split()[0])]] += 1
    (DS / 'labels' / bagian / f'{p.stem}.txt').write_text('\n'.join(baris))
    if (i + 1) % 200 == 0:
        print(f'  {i+1}/{len(sasaran)}', flush=True)

print(f'\nSELESAI. {len(selesai)} bingkai unik dilabeli ulang.')
print('  sebaran LAMA (semua salinan):', dict(sebelum))
print('  sebaran BARU (bingkai unik) :', dict(sesudah))
if sesudah:
    tot = sum(sesudah.values())
    print('  porsi baru:', {k: f'{v*100//tot}%' for k, v in sesudah.items()})
