# Image runtime detektor Ronda Digital ("motion-ai:latest").
#
# Sengaja TIDAK memuat torch/ultralytics: inferensi memakai OpenVINO langsung, jadi tidak ada
# container yang menghabiskan detik-detik awal untuk mengimpor torch. Terukur di produksi
# 13 Agustus 2026: 1,4 GB di disk (`docker system df -v`; angka `inspect .Size` 364 MB itu
# ukuran terkompresi, bukan pemakaian disk). Model .pt diekspor ke format OpenVINO SEKALI di luar image
# (lihat ekspor-model.sh) lalu dipasang lewat volume, bukan ikut dibangun ke dalam image.
#
# motion.py juga tidak disalin ke dalam image — ia ikut volume /work, supaya memperbaiki
# detektor tidak berarti membangun ulang image di server produksi.
FROM python:3.11-slim

# libgl1 + libglib2.0-0 dibutuhkan opencv; ffmpeg dipakai backend VideoCapture untuk RTSP.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
        "numpy>=2.1,<3" \
        "opencv-python-headless>=4.10" \
        "openvino>=2024.4" \
        "requests>=2.31,<3"

ENV PYTHONUNBUFFERED=1
WORKDIR /work
CMD ["python", "motion.py"]
