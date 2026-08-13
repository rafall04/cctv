#!/usr/bin/env bash
#
# Memasang runtime detektor Ronda Digital di server. Idempoten: aman dijalankan ulang.
#
# TIDAK menyalakan detektor apa pun. Setelah skrip ini selesai, halaman "Ronda Digital" di
# panel admin akan menampilkan tombol "+ Tambah Kamera"; kamera pertama dinyalakan dari sana,
# bukan dari sini. Itu disengaja: tiap detektor memakan ~2 core, jadi keputusan menyalakannya
# harus diambil sadar oleh operator yang melihat beban servernya.
#
# Pakai: bash pasang.sh [direktori-kerja]   (bawaan: /opt/yolo-poc)
set -euo pipefail

KERJA="${1:-/opt/yolo-poc}"
SUMBER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="motion-ai:latest"
MODEL="yolo11n320_openvino_model"

echo "==> Direktori kerja: $KERJA"
mkdir -p "$KERJA/config" "$KERJA/live"
install -m 0644 "$SUMBER/motion.py" "$KERJA/motion.py"

echo "==> Membangun image $IMAGE"
docker build -t "$IMAGE" -f "$SUMBER/Dockerfile" "$SUMBER"

if [ -d "$KERJA/$MODEL" ]; then
    echo "==> Model $MODEL sudah ada, dilewati"
else
    echo "==> Mengekspor $MODEL (sekali saja, butuh ultralytics)"
    bash "$SUMBER/ekspor-model.sh" "$KERJA"
fi

echo
echo "==> Selesai. Tidak ada detektor yang dijalankan."
# Ukuran diambil dari `docker images`, bukan `inspect .Size`: yang kedua melaporkan angka
# terkompresi (364 MB) sementara yang terpakai di disk 1,4 GB — beda hampir empat kali.
echo "    image   : $(docker images "$IMAGE" --format '{{.ID}}, {{.Size}} di disk')"
echo "    model   : $KERJA/$MODEL"
echo "    config  : $KERJA/config (berisi $(ls -1 "$KERJA/config" 2>/dev/null | wc -l) berkas)"
echo "    detektor: $(docker ps -a --filter 'name=motion-' --format '{{.Names}}' | wc -l) container"
