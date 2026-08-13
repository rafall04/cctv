"""Latih v3: banyak kamera Bojonegoro, siang + senja + malam.

Dua perubahan penting dibanding latih.py (v1/v2), keduanya konsekuensi langsung dari
berpindah dari SATU kamera ke DUA BELAS:

1. Augmentasi geometri DINYALAKAN. Pada v1/v2 `fliplr=0` benar: satu kamera tetap, jadi
   mengajari cerminan hanya membuang kapasitas untuk sudut pandang yang tak akan pernah
   dilihat. Sekarang bahannya 12 sudut pandang berbeda, dan model justru harus belajar
   bahwa "kendaraan" tidak bergantung pada arah hadap atau posisi di bingkai.
2. Ragam kecerahan tetap kuat (hsv_v 0.5) DAN bahannya kini benar-benar berisi malam.
   Pada v2 ragam ini sia-sia: augmentasi bisa menggelapkan bingkai siang, tetapi tidak bisa
   mengarang lampu jalan, silau aspal basah, atau motor yang menyusut jadi satu titik lampu.

Bobot awal sengaja dari yolo11s COCO, BUKAN melanjutkan v2: v2 sudah condong ke siang,
dan meneruskannya berarti mewarisi kecondongan itu.
"""
import os
import time

import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '10')))

DASAR = os.environ.get('MODEL_DASAR', 'yolo11s.pt')
IMGSZ = int(os.environ.get('IMGSZ', '448'))
EPOCH = int(os.environ.get('EPOCH', '22'))
BATCH = int(os.environ.get('BATCH', '16'))
BEKU = int(os.environ.get('FREEZE', '10'))

print(f'dasar={DASAR} imgsz={IMGSZ} epoch={EPOCH} batch={BATCH} freeze={BEKU} '
      f'threads={torch.get_num_threads()}', flush=True)

m = YOLO('/opt/yolo-demo/' + DASAR)
t0 = time.time()
m.train(
    data='/opt/yolo-demo/dataset_multi/data.yaml',
    epochs=EPOCH,
    imgsz=IMGSZ,
    batch=BATCH,
    freeze=BEKU,
    device='cpu',
    workers=4,
    project='/opt/yolo-demo/latihan',
    name='multi-v3',
    exist_ok=True,
    patience=8,
    val=True,
    plots=False,
    # 12 sudut pandang: cerminan dan geser kecil sekarang MEMBANTU generalisasi.
    fliplr=0.5,
    flipud=0.0,
    degrees=2.0,
    perspective=0.0,
    mosaic=0.5,
    scale=0.4,
    translate=0.1,
    hsv_h=0.015,
    hsv_s=0.6,
    hsv_v=0.5,
)
print(f'selesai dalam {(time.time()-t0)/60:.1f} menit', flush=True)
print('bobot:', '/opt/yolo-demo/latihan/multi-v3/weights/best.pt')
