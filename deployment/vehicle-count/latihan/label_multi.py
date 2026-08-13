"""Tahap 2: melabeli kolam bingkai (siang-senja dari rekaman + malam dari siaran langsung).

Tiga hal yang sengaja berbeda dari pelabelan v2, dan semuanya lahir dari kegagalan v2:

1. Bingkai gelap TIDAK dibuang. Itu justru bahan yang paling dibutuhkan.
2. Setiap bingkai diberi label kondisi (siang/senja/malam) dari kecerahannya, dan set
   validasi dibangun BERTINGKAT: ada val gabungan untuk latihan, plus val_siang dan
   val_malam terpisah untuk menilai. Satu angka gabungan bisa menyembunyikan kegagalan
   pada separuh kondisi - itu persis yang terjadi pada v2.
3. Ambang label untuk bingkai gelap dinaikkan. Guru cenderung memberi kotak pada SILAU
   lampu di aspal basah; ambang yang lebih tinggi membuang sebagian besar di antaranya.
   Sisanya tetap harus diperiksa dengan mata sebelum dilatih.
"""
import os
import random
import shutil
import time
from collections import Counter, defaultdict

import cv2
import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '8')))

DS = '/opt/yolo-demo/dataset_multi'
KOLAM_SIANG = '/opt/yolo-demo/kolam_multi'
KOLAM_MALAM = '/opt/yolo-demo/kolam_malam'
COCO2NEW = {3: 0, 2: 1, 7: 2, 5: 3}
NAMA = ['motor', 'mobil', 'truk', 'bus']

CONF_TERANG = 0.30
CONF_GELAP = 0.40            # lebih ketat: silau lampu gampang lolos di ambang rendah
BATAS_MALAM = 90             # kecerahan rata-rata di bawah ini dianggap malam
BATAS_SIANG = 118
MAKS_MALAM_PER_KAMERA = 200

random.seed(23)
for bagian in ('train', 'val', 'val_siang', 'val_malam'):
    os.makedirs(f'{DS}/images/{bagian}', exist_ok=True)
    os.makedirs(f'{DS}/labels/{bagian}', exist_ok=True)

penyaring = YOLO('/opt/yolo-demo/yolo11m.pt')
pelabel = YOLO('/opt/yolo-demo/yolo11x.pt')


def kondisi(terang):
    if terang < BATAS_MALAM:
        return 'malam'
    return 'siang' if terang >= BATAS_SIANG else 'senja'


# ---------- kumpulkan daftar bingkai ----------
tugas = []   # (jalur, cam, terang)
for f in sorted(os.listdir(KOLAM_SIANG)) if os.path.isdir(KOLAM_SIANG) else []:
    if not f.endswith('.jpg'):
        continue
    bagian = f.split('_')
    try:
        cam = int(bagian[0][1:])
        terang = int(bagian[2])
    except (ValueError, IndexError):
        continue
    tugas.append((f'{KOLAM_SIANG}/{f}', cam, terang))

# Bingkai malam ditangkap tanpa penyaringan, jadi disaring di sini dulu.
if os.path.isdir(KOLAM_MALAM):
    for sub in sorted(os.listdir(KOLAM_MALAM), key=lambda x: int(x) if x.isdigit() else 0):
        d = f'{KOLAM_MALAM}/{sub}'
        if not os.path.isdir(d):
            continue
        ambil = 0
        berkas = sorted(os.listdir(d))
        for f in berkas:
            if ambil >= MAKS_MALAM_PER_KAMERA or not f.endswith('.jpg'):
                continue
            img = cv2.imread(f'{d}/{f}')
            if img is None:
                continue
            r = penyaring.predict(img, imgsz=384, classes=list(COCO2NEW), conf=0.20,
                                  agnostic_nms=True, verbose=False)[0]
            if len(r.boxes) < 1:
                continue
            terang = int(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).mean())
            tugas.append((f'{d}/{f}', int(sub), terang))
            ambil += 1
        print(f'  saring malam cam{sub}: {ambil} dari {len(berkas)}', flush=True)

random.shuffle(tugas)
print(f'\nKolam mentah: {len(tugas)} bingkai, kondisi '
      f'{dict(Counter(kondisi(t) for _, _, t in tugas))}', flush=True)

# ---------- kuota: seimbangkan kondisi, lalu ratakan antar kamera ----------
# Melabeli seluruh kolam butuh ~2 jam dan melatihnya belasan jam. Yang menentukan mutu di
# sini bukan jumlah, melainkan KESEIMBANGAN: v2 punya 1.772 bingkai dan tetap gagal karena
# semuanya siang. Set yang lebih kecil tapi mencakup malam jauh lebih berguna.
TARGET = {'siang': 1400, 'senja': 900, 'malam': 900}
per_kondisi = defaultdict(list)
for t in tugas:
    per_kondisi[kondisi(t[2])].append(t)

terpilih = []
for kond, batas in TARGET.items():
    kolam = per_kondisi[kond]
    # ratakan antar kamera: ambil bergiliran dari tiap kamera
    per_cam = defaultdict(list)
    for t in kolam:
        per_cam[t[1]].append(t)
    giliran, habis = [], False
    while not habis and len(giliran) < batas:
        habis = True
        for cam in sorted(per_cam):
            if per_cam[cam]:
                giliran.append(per_cam[cam].pop())
                habis = False
                if len(giliran) >= batas:
                    break
    terpilih.extend(giliran)
    print(f'  {kond}: {len(giliran)} dari {len(kolam)} tersedia', flush=True)

tugas = terpilih
random.shuffle(tugas)
print(f'\nTotal bingkai untuk dilabeli: {len(tugas)}', flush=True)
print('  per kamera:', dict(sorted(Counter(c for _, c, _ in tugas).items())), flush=True)

# ---------- label dengan guru ----------
t0 = time.time()
kelas_per_kondisi = defaultdict(Counter)
per_bagian = Counter()
tersimpan = 0
for i, (jalur, cam, terang) in enumerate(tugas):
    img = cv2.imread(jalur)
    if img is None:
        continue
    kond = kondisi(terang)
    conf = CONF_GELAP if kond == 'malam' else CONF_TERANG
    r = pelabel.predict(img, imgsz=512, classes=list(COCO2NEW), conf=conf,
                        augment=True, agnostic_nms=True, verbose=False)[0]
    baris = []
    for box, cl in zip(r.boxes.xywhn.tolist(), r.boxes.cls.tolist()):
        k = COCO2NEW[int(cl)]
        kelas_per_kondisi[kond][NAMA[k]] += 1
        baris.append(f'{k} {box[0]:.6f} {box[1]:.6f} {box[2]:.6f} {box[3]:.6f}')

    nama = f'c{cam}_{kond}_{terang:03d}_{i:05d}.jpg'
    bagian = 'val' if i % 8 == 0 else 'train'
    shutil.copy(jalur, f'{DS}/images/{bagian}/{nama}')
    with open(f'{DS}/labels/{bagian}/{nama[:-4]}.txt', 'w') as fh:
        fh.write('\n'.join(baris))
    per_bagian[bagian] += 1
    # salinan kedua untuk penilaian terpisah per kondisi
    if bagian == 'val':
        khusus = 'val_malam' if kond == 'malam' else ('val_siang' if kond == 'siang' else None)
        if khusus:
            shutil.copy(jalur, f'{DS}/images/{khusus}/{nama}')
            with open(f'{DS}/labels/{khusus}/{nama[:-4]}.txt', 'w') as fh:
                fh.write('\n'.join(baris))
            per_bagian[khusus] += 1
    tersimpan += 1
    if (i + 1) % 200 == 0:
        print(f'  {i+1}/{len(tugas)} ({(time.time()-t0)/60:.1f} mnt)', flush=True)

for nama_yaml, val_dir in (('data.yaml', 'images/val'),
                           ('data_siang.yaml', 'images/val_siang'),
                           ('data_malam.yaml', 'images/val_malam')):
    with open(f'{DS}/{nama_yaml}', 'w') as fh:
        fh.write(f'path: {DS}\ntrain: images/train\nval: {val_dir}\nnc: 4\nnames: {NAMA}\n')

print(f'\nSELESAI: {tersimpan} bingkai dalam {(time.time()-t0)/60:.1f} menit')
print('  pembagian:', dict(per_bagian))
for k in ('siang', 'senja', 'malam'):
    print(f'  kelas {k}:', dict(kelas_per_kondisi[k]))
