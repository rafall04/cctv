"""Menilai beberapa model pada SETIAP kondisi cahaya secara terpisah.

Berkas ini ada karena satu angka gabungan pernah menipu: v2 unggul 0,629 vs 0,602 pada
validasi gabungan, lalu gagal setelah senja. Rata-rata bisa naik sementara separuh kondisi
memburuk, dan itu tidak akan pernah terlihat kalau yang dilaporkan hanya satu bilangan.

Aturan pakainya: sebuah model baru hanya boleh menggantikan yang lama bila TIDAK ADA
kondisi yang memburuk secara berarti - bukan sekadar rata-ratanya naik.
"""
import os
import sys

import torch
from ultralytics import YOLO

torch.set_num_threads(int(os.environ.get('TORCH_THREADS', '8')))

DS = '/opt/yolo-demo/dataset_multi'
MODEL = {
    'v1 (dipakai)': '/opt/yolo-demo/kamera15-v1.pt',
    'v2 (ditarik)': '/opt/yolo-demo/kamera15-v2.pt',
    'v3 (baru)': '/opt/yolo-demo/latihan/multi-v3/weights/best.pt',
}
KONDISI = [
    ('gabungan', f'{DS}/data.yaml'),
    ('siang', f'{DS}/data_siang.yaml'),
    ('senja', f'{DS}/data_senja.yaml'),
    ('malam', f'{DS}/data_malam.yaml'),
]

hasil = {}
for label, jalur in MODEL.items():
    if not os.path.exists(jalur):
        print(f'  {label}: bobot tidak ada, dilewati', flush=True)
        continue
    m = YOLO(jalur)
    hasil[label] = {}
    for kond, yaml in KONDISI:
        if not os.path.exists(yaml):
            continue
        try:
            r = m.val(data=yaml, imgsz=448, conf=0.001, verbose=False, plots=False)
            hasil[label][kond] = {
                'map': float(r.box.map), 'map50': float(r.box.map50),
                'kelas': {n: float(r.box.maps[i]) for i, n in m.names.items()},
            }
        except Exception as e:                       # noqa: BLE001
            print(f'  {label}/{kond} gagal: {e}', flush=True)
    print(f'  {label}: selesai', flush=True)

print('\n=== mAP50-95 per kondisi ===')
kepala = 'model'.ljust(16) + ''.join(k.ljust(11) for k, _ in KONDISI)
print('  ' + kepala)
for label, per in hasil.items():
    baris = label.ljust(16)
    for kond, _ in KONDISI:
        baris += (f"{per[kond]['map']:.4f}".ljust(11) if kond in per else '-'.ljust(11))
    print('  ' + baris)

print('\n=== per kelas, kondisi MALAM (yang membuat v2 ditarik) ===')
for label, per in hasil.items():
    if 'malam' in per:
        k = per['malam']['kelas']
        print(f"  {label.ljust(16)} " + " ".join(f"{n} {v:.3f}" for n, v in k.items()))

print('\n=== per kelas, kondisi SENJA ===')
for label, per in hasil.items():
    if 'senja' in per:
        k = per['senja']['kelas']
        print(f"  {label.ljust(16)} " + " ".join(f"{n} {v:.3f}" for n, v in k.items()))

# Putusan otomatis: v3 hanya lolos bila tak ada kondisi yang turun berarti dari v1.
acuan, calon = 'v1 (dipakai)', 'v3 (baru)'
if acuan in hasil and calon in hasil:
    print('\n=== putusan ===')
    aman = True
    for kond, _ in KONDISI:
        if kond not in hasil[acuan] or kond not in hasil[calon]:
            continue
        a, b = hasil[acuan][kond]['map'], hasil[calon][kond]['map']
        tanda = 'naik' if b > a else 'TURUN'
        if b < a - 0.02:
            aman = False
            tanda = 'TURUN BERARTI'
        print(f'  {kond.ljust(10)} {a:.4f} -> {b:.4f}  {tanda}')
    print('  LAYAK DIPASANG' if aman else '  JANGAN DIPASANG: ada kondisi yang memburuk')
