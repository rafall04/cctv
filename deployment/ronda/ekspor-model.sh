#!/usr/bin/env bash
#
# Mengekspor yolo11n ke format OpenVINO pada imgsz 320, sekali saja, ke <kerja>/yolo11n320_openvino_model.
#
# Ekspor butuh ultralytics+torch (~2 GB), runtime-nya tidak. Karena itu ekspor dikerjakan di
# LUAR image, dan kalau server sudah punya venv penghitung kendaraan (/opt/yolo-demo/venv), venv
# itulah yang dipinjam — TANPA memasang apa pun ke dalamnya: openvino dipasang ke direktori
# sementara lalu ditunjuk lewat PYTHONPATH. Memasang paket ke venv yang sedang menjalankan
# penghitung kendaraan berarti mempertaruhkan demo yang sedang hidup demi menghemat unduhan.
set -euo pipefail

KERJA="${1:-/opt/yolo-poc}"
TUJUAN="$KERJA/yolo11n320_openvino_model"
VENV_PY="/opt/yolo-demo/venv/bin/python"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

if [ -x "$VENV_PY" ] && "$VENV_PY" -c 'import ultralytics' 2>/dev/null; then
    echo "    meminjam ultralytics dari $VENV_PY (venv tidak diubah)"
    PY="$VENV_PY"
    "$PY" -m pip install --quiet --target "$TMP/ovlib" "openvino>=2024.4"
    export PYTHONPATH="$TMP/ovlib"
else
    echo "    membuat venv sementara (unduhan besar: torch + ultralytics)"
    python3 -m venv "$TMP/venv"
    PY="$TMP/venv/bin/python"
    "$PY" -m pip install --quiet --upgrade pip
    "$PY" -m pip install --quiet ultralytics "openvino>=2024.4"
fi

cd "$TMP"
"$PY" - <<'EOS'
from ultralytics import YOLO

# imgsz dikunci 320: kalau angka ini berubah, ubah juga CONFIRM_IMGSZ di rondaDetectorService.js.
# Model diekspor dengan bentuk masukan tetap, jadi ketidakcocokan akan gagal saat inferensi.
YOLO("yolo11n.pt").export(format="openvino", imgsz=320, half=False)
EOS

HASIL="$(find "$TMP" -maxdepth 2 -type d -name '*_openvino_model' | head -1)"
[ -n "$HASIL" ] || { echo "    GAGAL: hasil ekspor tidak ditemukan" >&2; exit 1; }

rm -rf "$TUJUAN"
mkdir -p "$KERJA"
mv "$HASIL" "$TUJUAN"
echo "    model tersimpan: $TUJUAN"
ls -1 "$TUJUAN"
