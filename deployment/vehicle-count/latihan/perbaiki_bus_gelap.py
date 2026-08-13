"""Membetulkan label 'bus' pada bingkai gelap menjadi 'truk'.

Kenapa perlu, dan kenapa seberani ini:

Guru (yolo11x, kelas COCO) tidak mengenal truk kargo Indonesia. Malam hari, bak tinggi
berpagar yang disorot lampu depan tampak seperti badan bus, dan ia melabelinya 'bus'.
Akibatnya pada bingkai gelap, 'bus' mencakup 22-68% kendaraan berat tergantung kamera -
cam15 sendiri 45%. Kebenaran siang hari di koridor ini: bus hanya ~3%.

Model v3 mewarisi persis kekeliruan itu: pada 90 bingkai malam ia melaporkan 41% bus,
sementara v1 16%. Yang menarik, truk+bus digabung hampir sama (78% lawan 80%) - keduanya
sepakat itu kendaraan berat, hanya garis batas truk/bus yang berbeda.

Dua puluh empat potongan gambar deteksi 'bus' malam diperiksa satu per satu: SEMUANYA truk
kargo. Karena itu koreksi ini menyeluruh untuk bingkai gelap, bukan per-kotak.

Harganya jujur: bus malam yang ASLI akan ikut tercatat sebagai truk. Dengan porsi bus ~3%
di siang hari, kerugian itu jauh lebih kecil daripada melaporkan 41% bus ke pelanggan.
Label bus pada bingkai TERANG tidak disentuh - di sana guru membedakannya dengan benar.
"""
import os
from collections import Counter
from pathlib import Path

DS = Path('/opt/yolo-demo/dataset_multi')
AMBANG_TERANG = 105
BUS, TRUK = '3', '2'

diubah = Counter()
berkas_tersentuh = 0
for bagian in ('train', 'val', 'val_siang', 'val_senja', 'val_malam'):
    d = DS / 'labels' / bagian
    if not d.is_dir():
        continue
    for lab in d.glob('*.txt'):
        bag = lab.stem.split('_')
        try:
            terang = int(bag[2])
        except (ValueError, IndexError):
            continue
        if terang >= AMBANG_TERANG:
            continue
        baris = lab.read_text().strip().splitlines()
        baru, n = [], 0
        for b in baris:
            if not b.strip():
                continue
            bagi = b.split()
            if bagi[0] == BUS:
                bagi[0] = TRUK
                n += 1
            baru.append(' '.join(bagi))
        if n:
            lab.write_text('\n'.join(baru))
            diubah[bagian] += n
            berkas_tersentuh += 1

print(f'{berkas_tersentuh} berkas label disunting')
print('  kotak bus -> truk per bagian:', dict(diubah))
print('  total:', sum(diubah.values()))

# sebaran sesudah, untuk bingkai gelap
sisa = Counter()
NAMA = ['motor', 'mobil', 'truk', 'bus']
for lab in (DS / 'labels/train').glob('*.txt'):
    bag = lab.stem.split('_')
    try:
        terang = int(bag[2])
    except (ValueError, IndexError):
        continue
    if terang >= AMBANG_TERANG:
        continue
    for b in lab.read_text().strip().splitlines():
        if b.strip():
            sisa[NAMA[int(b.split()[0])]] += 1
print('  sebaran gelap sesudah koreksi:', dict(sisa))
