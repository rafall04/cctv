#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Purpose: Detektor gerakan "Ronda Digital" — satu container per kamera.
Caller: backend/services/rondaDetectorService.js (docker run ... python motion.py).
Deps: opencv-python-headless, numpy, openvino, requests. TIDAK memakai torch/ultralytics.
MainFuncs: main() -> loop baca frame -> deteksi gerak -> konfirmasi YOLO -> peringatan Telegram.
SideEffects: menulis latest.jpg, status.json, events.jsonl, dan snaps/ di OUT_DIR; mengirim
             foto ke Telegram; membaca CONFIG_PATH tiap CONFIG_EVERY detik.

KONTRAK — jangan diubah sepihak. Semua nama env var di bawah dikirim oleh `#runArgs` di
rondaDetectorService.js, dan semua kunci config yang dibaca ulang saat berjalan adalah daftar
EDITABLE di rondaConfigService.js. Menambah setelan berarti menyentuh ketiga berkas itu; kalau
tidak, panel akan tampak menyimpan padahal detektor tidak pernah membacanya.

Kenapa openvino langsung, bukan ultralytics: tidak ada container yang perlu mengimpor torch
hanya untuk satu model nano, dan image tetap 1,4 GB (terukur di produksi 13 Agustus 2026).
Konsekuensinya letterbox dan NMS ditulis sendiri di sini — itu bagian yang paling perlu dijaga
saat mengganti model.

Deteksi gerak DULU, YOLO belakangan: menjalankan YOLO tiap frame akan memakan CPU yang di server
ini sudah dipakai puluhan ffmpeg. MOG2 murah; YOLO hanya dipanggil saat ada gerakan yang sudah
bertahan CONFIRM detik, dan paling cepat tiap GATE_COOLDOWN detik.
"""

import json
import os
import sys
import threading
import time
from collections import deque
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

# --------------------------------------------------------------------------------------
# Pembacaan env
# --------------------------------------------------------------------------------------


def env_str(nama, bawaan=""):
    v = os.environ.get(nama)
    return bawaan if v is None or v == "" else v


def env_int(nama, bawaan):
    try:
        return int(float(env_str(nama, "")))
    except ValueError:
        return bawaan


def env_float(nama, bawaan):
    try:
        return float(env_str(nama, ""))
    except ValueError:
        return bawaan


def env_json(nama, bawaan):
    try:
        v = json.loads(env_str(nama, ""))
        return v if isinstance(v, list) else bawaan
    except (ValueError, TypeError):
        return bawaan


RTSP_URL = env_str("RTSP_URL")
OUT_DIR = Path(env_str("OUT_DIR", "/work/live/motion"))
CONFIG_PATH = Path(env_str("CONFIG_PATH", ""))
CONFIG_EVERY = env_int("CONFIG_EVERY", 15)

PROC_W = env_int("PROC_W", 960)
TARGET_FPS = max(1, env_int("TARGET_FPS", 5))
VAR_THRESH = env_float("VAR_THRESH", 50)
DETECT_SHADOW = env_int("DETECT_SHADOW", 1) == 1
GLOBAL_FRAC = env_float("GLOBAL_FRAC", 0.6)
CONFIRM_SEC = env_float("CONFIRM", 2.5)
DEBOUNCE_SEC = env_float("DEBOUNCE", 3)

CONFIRM_MODEL = env_str("CONFIRM_MODEL", "/work/yolo11n320_openvino_model")
CONFIRM_IMGSZ = env_int("CONFIRM_IMGSZ", 320)
GATE_COOLDOWN = env_float("GATE_COOLDOWN", 10)
GATE_CROP = env_float("GATE_CROP", 0.55)

RETENTION_DAYS = env_int("RETENTION_DAYS", 7)
MAX_SNAPS = env_int("MAX_SNAPS", 50)
MAX_EVENTS = env_int("MAX_EVENTS", 20000)

BOT_TOKEN = env_str("TELEGRAM_BOT_TOKEN")
TG_TEST = env_int("TG_TEST", 0) == 1

# Nilai-nilai ini juga ada di config dan boleh berubah saat berjalan; env hanya jadi nilai awal.
AWAL = {
    "enabled": True,
    "label": env_str("CAM_LABEL", "Kamera"),
    "area": env_str("AREA_LABEL", "-"),
    "min_area": env_int("MIN_AREA", 700),
    "confirm_conf": env_float("CONFIRM_CONF", 0.15),
    "confirm_classes": env_str("CONFIRM_CLASSES", "person,bicycle,car,motorcycle,bus,truck"),
    "alert_hours": env_str("ALERT_HOURS", ""),
    "tg_cooldown": env_float("TG_COOLDOWN", 12),
    "tg_cooldown_off": env_float("TG_COOLDOWN_OFF", 300),
    "chat_id": env_str("TELEGRAM_CHAT_ID"),
    "ignore": env_json("IGNORE_ZONES", []),
    "roi": env_json("ROI_JSON", []),
}

CROP_LIMIT = env_str("CROP_LIMIT", "0,0,1,1")

KELAS_COCO = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat", "dog",
    "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack", "umbrella",
    "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball", "kite",
    "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket", "bottle",
    "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich",
    "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
    "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse", "remote",
    "keyboard", "cell phone", "microwave", "oven", "toaster", "sink", "refrigerator", "book",
    "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]


def log(*bagian):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}]", *bagian, flush=True)


# --------------------------------------------------------------------------------------
# Setelan yang bisa berubah saat berjalan
# --------------------------------------------------------------------------------------


class Setelan:
    """Config yang dibaca ulang dari berkas tiap CONFIG_EVERY detik, tanpa restart.

    Panel admin menjanjikan "berlaku dalam ±15 detik tanpa restart" — janji itu ditepati di
    sini. Berkas ditulis atomik (tmp+rename) oleh backend, jadi pembacaan parsial tidak mungkin;
    bila JSON tetap gagal diurai, nilai lama dipertahankan supaya satu berkas rusak tidak
    mematikan pemantauan.
    """

    def __init__(self):
        self.nilai = dict(AWAL)
        self._mtime = 0.0
        self._dicek = 0.0
        self.muat_ulang = 0
        self.muat(paksa=True)

    def muat(self, paksa=False):
        if not CONFIG_PATH or not CONFIG_PATH.exists():
            return
        try:
            mtime = CONFIG_PATH.stat().st_mtime
        except OSError:
            return
        if not paksa and mtime == self._mtime:
            return
        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except (ValueError, OSError) as e:
            log("config gagal dibaca, memakai nilai lama:", e)
            return
        if not isinstance(data, dict):
            return
        for kunci in AWAL:
            if kunci in data and data[kunci] is not None:
                self.nilai[kunci] = data[kunci]
        self._mtime = mtime
        if not paksa:
            self.muat_ulang += 1
            log(f"setelan dimuat ulang (ke-{self.muat_ulang})")

    def mungkin_muat_ulang(self, sekarang):
        if sekarang - self._dicek < CONFIG_EVERY:
            return
        self._dicek = sekarang
        self.muat()

    def __getitem__(self, kunci):
        return self.nilai.get(kunci)

    @property
    def aktif(self):
        return bool(self.nilai.get("enabled", True))

    @property
    def kelas_dikonfirmasi(self):
        mentah = str(self.nilai.get("confirm_classes") or "")
        return {k.strip() for k in mentah.split(",") if k.strip()}

    def dalam_jam_ronda(self, saat=None):
        """True bila waktu sekarang berada dalam ALERT_HOURS (boleh melewati tengah malam)."""
        rentang = str(self.nilai.get("alert_hours") or "").strip()
        if not rentang:
            return True                                   # kosong = siaga sepanjang hari
        try:
            mulai_s, selesai_s = rentang.split("-")
            jm, mm = (int(x) for x in mulai_s.split(":"))
            js, ms = (int(x) for x in selesai_s.split(":"))
        except ValueError:
            return True
        saat = saat or datetime.now()
        menit = saat.hour * 60 + saat.minute
        mulai, selesai = jm * 60 + mm, js * 60 + ms
        if mulai == selesai:
            return True
        if mulai < selesai:
            return mulai <= menit < selesai
        return menit >= mulai or menit < selesai          # melewati tengah malam


# --------------------------------------------------------------------------------------
# Sumber frame
# --------------------------------------------------------------------------------------


class SumberRTSP:
    """Pembaca RTSP dengan thread sendiri.

    Dibaca terus-menerus di thread terpisah dan hanya frame TERBARU yang disimpan. Kalau loop
    utama ikut membaca berurutan, frame menumpuk di buffer dan gambar yang dianalisis makin
    tertinggal dari kenyataan — pada detektor keamanan itu berarti peringatan datang terlambat.
    """

    def __init__(self, url):
        self.url = url
        self.frame = None
        self.stempel = 0.0
        self.sambung_ulang = 0
        self._kunci = threading.Lock()
        self._berhenti = False
        self._t = threading.Thread(target=self._jalan, daemon=True)
        self._t.start()

    def _buka(self):
        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
        try:
            cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except cv2.error:
            pass
        return cap

    def _jalan(self):
        cap = None
        while not self._berhenti:
            if cap is None or not cap.isOpened():
                if cap is not None:
                    cap.release()
                    self.sambung_ulang += 1
                    log(f"menyambung ulang RTSP (ke-{self.sambung_ulang})")
                    time.sleep(3)
                cap = self._buka()
                if not cap.isOpened():
                    time.sleep(3)
                    continue
            ok, frame = cap.read()
            if not ok or frame is None:
                cap.release()
                cap = None
                continue
            with self._kunci:
                self.frame = frame
                self.stempel = time.time()

    def terbaru(self):
        with self._kunci:
            return (None, 0.0) if self.frame is None else (self.frame.copy(), self.stempel)


# --------------------------------------------------------------------------------------
# YOLO lewat OpenVINO
# --------------------------------------------------------------------------------------


class Pengonfirmasi:
    """YOLO11n dalam format OpenVINO — dipakai hanya untuk membuktikan gerakan itu benda apa.

    Model dimuat malas (saat dipakai pertama kali) supaya container tetap hidup dan tetap
    menulis pratinjau meski modelnya belum ada; tanpa itu, satu berkas model yang hilang membuat
    editor zona di panel ikut buta.
    """

    def __init__(self, direktori, imgsz):
        self.direktori = Path(direktori)
        self.imgsz = imgsz
        self._model = None
        self._gagal = False

    def siap(self):
        if self._model is not None:
            return True
        if self._gagal or not self.direktori.exists():
            return False
        try:
            from openvino import Core                      # noqa: PLC0415 — sengaja malas
            xml = next(self.direktori.glob("*.xml"), None)
            if xml is None:
                raise FileNotFoundError(f"tidak ada berkas .xml di {self.direktori}")
            inti = Core()
            self._model = inti.compile_model(inti.read_model(str(xml)), "CPU")
            self._keluaran = self._model.output(0)
            log(f"model konfirmasi dimuat: {xml}")
            return True
        except Exception as e:                             # noqa: BLE001 — apa pun, jangan mati
            self._gagal = True
            log("model konfirmasi tidak bisa dimuat:", e)
            return False

    def _letterbox(self, gambar):
        t, l = gambar.shape[:2]
        skala = min(self.imgsz / l, self.imgsz / t)
        lb, tb = max(1, int(round(l * skala))), max(1, int(round(t * skala)))
        kecil = cv2.resize(gambar, (lb, tb), interpolation=cv2.INTER_LINEAR)
        kanvas = np.full((self.imgsz, self.imgsz, 3), 114, dtype=np.uint8)
        dx, dy = (self.imgsz - lb) // 2, (self.imgsz - tb) // 2
        kanvas[dy:dy + tb, dx:dx + lb] = kecil
        return kanvas, skala, dx, dy

    def deteksi(self, gambar, ambang, kelas_diminta):
        """-> [(nama, skor, (x1,y1,x2,y2))] dalam koordinat `gambar`."""
        if not self.siap() or gambar.size == 0:
            return []
        kanvas, skala, dx, dy = self._letterbox(gambar)
        masukan = kanvas[:, :, ::-1].transpose(2, 0, 1)[None].astype(np.float32) / 255.0
        keluar = self._model([np.ascontiguousarray(masukan)])[self._keluaran]

        # yolo11 keluar sebagai (1, 4+80, N): 4 baris kotak (cx,cy,w,h) lalu skor tiap kelas.
        data = np.squeeze(keluar, 0)
        if data.shape[0] < data.shape[1]:
            data = data.T                                  # -> (N, 84)
        kotak_mentah, skor_kelas = data[:, :4], data[:, 4:]
        skor = skor_kelas.max(axis=1)
        indeks = skor_kelas.argmax(axis=1)

        pilih = skor >= ambang
        if kelas_diminta:
            nama_semua = np.array([
                KELAS_COCO[i] if i < len(KELAS_COCO) else str(i) for i in indeks
            ])
            pilih &= np.isin(nama_semua, list(kelas_diminta))
        if not pilih.any():
            return []

        kotak_mentah, skor, indeks = kotak_mentah[pilih], skor[pilih], indeks[pilih]
        cx, cy, w, h = kotak_mentah.T
        x1 = (cx - w / 2 - dx) / skala
        y1 = (cy - h / 2 - dy) / skala
        lebar, tinggi = w / skala, h / skala

        kotak_nms = np.stack([x1, y1, lebar, tinggi], axis=1).tolist()
        simpan = cv2.dnn.NMSBoxes(kotak_nms, skor.tolist(), float(ambang), 0.45)
        if simpan is None or len(simpan) == 0:
            return []

        tinggi_g, lebar_g = gambar.shape[:2]
        hasil = []
        for i in np.array(simpan).flatten():
            gx1 = int(max(0, min(lebar_g - 1, x1[i])))
            gy1 = int(max(0, min(tinggi_g - 1, y1[i])))
            gx2 = int(max(0, min(lebar_g - 1, x1[i] + lebar[i])))
            gy2 = int(max(0, min(tinggi_g - 1, y1[i] + tinggi[i])))
            nama = KELAS_COCO[indeks[i]] if indeks[i] < len(KELAS_COCO) else str(indeks[i])
            hasil.append((nama, float(skor[i]), (gx1, gy1, gx2, gy2)))
        return hasil


# --------------------------------------------------------------------------------------
# Telegram
# --------------------------------------------------------------------------------------


class Telegram:
    def __init__(self, token):
        self.token = token
        self.terakhir = 0.0

    def _kirim(self, jalur, data, berkas=None):
        if not self.token:
            return False
        try:
            import requests                                # noqa: PLC0415
            r = requests.post(
                f"https://api.telegram.org/bot{self.token}/{jalur}",
                data=data, files=berkas, timeout=20,
            )
            if not r.ok:
                log("telegram gagal:", r.status_code, r.text[:160])
            return r.ok
        except Exception as e:                             # noqa: BLE001
            log("telegram galat:", e)
            return False

    def pesan(self, chat_id, teks):
        if not chat_id:
            return False
        return self._kirim("sendMessage", {"chat_id": chat_id, "text": teks})

    def foto(self, chat_id, jpg, keterangan):
        if not chat_id:
            return False
        return self._kirim(
            "sendPhoto",
            {"chat_id": chat_id, "caption": keterangan},
            {"photo": ("ronda.jpg", jpg, "image/jpeg")},
        )


# --------------------------------------------------------------------------------------
# Zona & gambar
# --------------------------------------------------------------------------------------


def batas_crop(teks, lebar, tinggi):
    try:
        a, b, c, d = (float(x) for x in str(teks).split(","))
    except (ValueError, AttributeError):
        a, b, c, d = 0.0, 0.0, 1.0, 1.0
    x1, y1 = int(a * lebar), int(b * tinggi)
    x2, y2 = int(c * lebar), int(d * tinggi)
    if x2 - x1 < 16 or y2 - y1 < 16:
        return 0, 0, lebar, tinggi
    return x1, y1, x2, y2


def titik_diabaikan(px, py, lebar, tinggi, zona):
    for z in zona or []:
        try:
            x1, y1, x2, y2 = (float(v) for v in z)
        except (ValueError, TypeError):
            continue
        if x1 * lebar <= px <= x2 * lebar and y1 * tinggi <= py <= y2 * tinggi:
            return True
    return False


def poligon_roi(roi, lebar, tinggi):
    if not roi or len(roi) < 3:
        return None
    try:
        return np.array([[float(p[0]) * lebar, float(p[1]) * tinggi] for p in roi], dtype=np.int32)
    except (ValueError, TypeError, IndexError):
        return None


def gambar_penanda(bingkai, setelan, kotak_gerak, deteksi):
    """Bingkai beranotasi untuk pratinjau panel — zona persis seperti yang dilihat detektor."""
    tinggi, lebar = bingkai.shape[:2]
    for z in setelan["ignore"] or []:
        try:
            x1, y1, x2, y2 = (float(v) for v in z)
        except (ValueError, TypeError):
            continue
        cv2.rectangle(bingkai, (int(x1 * lebar), int(y1 * tinggi)),
                      (int(x2 * lebar), int(y2 * tinggi)), (60, 60, 220), 2)
    poli = poligon_roi(setelan["roi"], lebar, tinggi)
    if poli is not None:
        cv2.polylines(bingkai, [poli], True, (80, 220, 80), 2)
    for (x1, y1, x2, y2) in kotak_gerak:
        cv2.rectangle(bingkai, (x1, y1), (x2, y2), (40, 200, 240), 2)
    for nama, skor, (x1, y1, x2, y2) in deteksi:
        cv2.rectangle(bingkai, (x1, y1), (x2, y2), (240, 200, 40), 2)
        cv2.putText(bingkai, f"{nama} {skor:.2f}", (x1, max(14, y1 - 6)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.5, (240, 200, 40), 2)
    judul = f"{setelan['label']} - {setelan['area']}"
    if not setelan.aktif:
        judul += "  [PANTAUAN DIMATIKAN]"
    cv2.putText(bingkai, judul, (10, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    cv2.putText(bingkai, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), (10, tinggi - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    return bingkai


# --------------------------------------------------------------------------------------
# Penyimpanan
# --------------------------------------------------------------------------------------


def tulis_atomik(berkas: Path, data: bytes):
    tmp = berkas.with_suffix(berkas.suffix + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(berkas)


def rapikan(dir_snap: Path, berkas_event: Path):
    """Buang cuplikan lama. Retensi dijalankan berkala, bukan tiap event, supaya tidak
    menyentuh disk pada jalur yang sedang diburu waktu."""
    try:
        snaps = sorted(dir_snap.glob("*.jpg"), key=lambda p: p.stat().st_mtime)
    except OSError:
        return
    batas_umur = time.time() - RETENTION_DAYS * 86400
    buang = [p for p in snaps if p.stat().st_mtime < batas_umur]
    sisa = [p for p in snaps if p not in buang]
    if len(sisa) > MAX_SNAPS:
        buang += sisa[:len(sisa) - MAX_SNAPS]
    for p in buang:
        try:
            p.unlink()
        except OSError:
            pass
    try:
        if berkas_event.exists():
            baris = berkas_event.read_text(encoding="utf-8").splitlines()
            if len(baris) > MAX_EVENTS:
                sisa_baris = baris[-MAX_EVENTS:]
                tulis_atomik(berkas_event, ("\n".join(sisa_baris) + "\n").encode("utf-8"))
    except OSError:
        pass


# --------------------------------------------------------------------------------------


def main():
    if not RTSP_URL:
        log("RTSP_URL kosong — tidak ada yang bisa dipantau.")
        return 2

    dir_snap = OUT_DIR / "snaps"
    dir_snap.mkdir(parents=True, exist_ok=True)
    berkas_status = OUT_DIR / "status.json"
    berkas_event = OUT_DIR / "events.jsonl"
    berkas_pratinjau = OUT_DIR / "latest.jpg"

    setelan = Setelan()
    sumber = SumberRTSP(RTSP_URL)
    pengonfirmasi = Pengonfirmasi(CONFIRM_MODEL, CONFIRM_IMGSZ)
    telegram = Telegram(BOT_TOKEN)

    mog2 = cv2.createBackgroundSubtractorMOG2(
        history=500, varThreshold=VAR_THRESH, detectShadows=DETECT_SHADOW,
    )
    inti = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))

    log(f"Ronda mulai: {setelan['label']} | {RTSP_URL} | proc_w={PROC_W} fps={TARGET_FPS}")
    if TG_TEST:
        telegram.pesan(setelan["chat_id"], f"Uji Ronda Digital: {setelan['label']} aktif.")

    gerak_sejak = None
    gerak_terakhir = 0.0
    event_terbuka = False
    gate_terakhir = 0.0
    tulis_terakhir = 0.0
    rapi_terakhir = time.time()
    event_hari_ini = 0
    hari_ini = datetime.now().date()
    riwayat_fps = deque(maxlen=30)
    deteksi_terakhir = []
    jeda = 1.0 / TARGET_FPS

    while True:
        putaran = time.time()
        setelan.mungkin_muat_ulang(putaran)

        bingkai, stempel = sumber.terbaru()
        if bingkai is None:
            # Sumber belum terbaca (alamat salah, kamera mati, kredensial berubah). Status TETAP
            # ditulis supaya panel bisa membedakan "detektor mati" dari "detektor hidup tapi tidak
            # dapat gambar" — tanpa ini, URL yang salah hanya tampak sebagai titik abu-abu tanpa
            # keterangan, dan itulah yang terjadi saat uji pemasangan pertama.
            if time.time() - tulis_terakhir >= 2.0:
                tulis_terakhir = time.time()
                try:
                    tulis_atomik(berkas_status, json.dumps({
                        "ts": datetime.now().isoformat(timespec="seconds"),
                        "events_today": event_hari_ini,
                        "enabled": setelan.aktif,
                        "label": setelan["label"],
                        "area": setelan["area"],
                        "sumber_terbaca": False,
                        "sambung_ulang": sumber.sambung_ulang,
                        "setelan_dimuat_ulang": setelan.muat_ulang,
                    }, ensure_ascii=False).encode("utf-8"))
                except OSError:
                    pass
            time.sleep(0.5)
            continue

        tinggi_asli, lebar_asli = bingkai.shape[:2]
        cx1, cy1, cx2, cy2 = batas_crop(CROP_LIMIT, lebar_asli, tinggi_asli)
        bingkai = bingkai[cy1:cy2, cx1:cx2]
        if bingkai.size == 0:
            time.sleep(0.5)
            continue

        skala = PROC_W / bingkai.shape[1]
        kerja = cv2.resize(bingkai, (PROC_W, max(1, int(bingkai.shape[0] * skala))))
        tinggi, lebar = kerja.shape[:2]

        kabur = cv2.GaussianBlur(cv2.cvtColor(kerja, cv2.COLOR_BGR2GRAY), (5, 5), 0)
        topeng = mog2.apply(kabur)
        _, topeng = cv2.threshold(topeng, 200, 255, cv2.THRESH_BINARY)   # 127 = bayangan, dibuang
        topeng = cv2.morphologyEx(topeng, cv2.MORPH_OPEN, inti)
        topeng = cv2.dilate(topeng, inti, iterations=2)

        poli = poligon_roi(setelan["roi"], lebar, tinggi)
        kontur, _ = cv2.findContours(topeng, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        min_area = float(setelan["min_area"] or 700)

        kotak_gerak, luas_total = [], 0.0
        for k in kontur:
            luas = cv2.contourArea(k)
            if luas < min_area:
                continue
            x, y, w, h = cv2.boundingRect(k)
            px, py = x + w / 2, y + h / 2
            if titik_diabaikan(px, py, lebar, tinggi, setelan["ignore"]):
                continue
            if poli is not None and cv2.pointPolygonTest(poli, (float(px), float(py)), False) < 0:
                continue
            kotak_gerak.append((x, y, x + w, y + h))
            luas_total += luas

        # Lampu menyala, awan lewat, kamera auto-exposure: hampir seluruh bingkai "bergerak".
        # Itu bukan orang, dan mengirimkannya akan melatih pemilik untuk mengabaikan peringatan.
        global_berubah = luas_total > GLOBAL_FRAC * (lebar * tinggi)
        if global_berubah:
            kotak_gerak = []

        sekarang = time.time()
        if kotak_gerak:
            gerak_terakhir = sekarang
            if gerak_sejak is None:
                gerak_sejak = sekarang
        elif gerak_sejak is not None and sekarang - gerak_terakhir > DEBOUNCE_SEC:
            gerak_sejak = None
            event_terbuka = False

        # `kotak_gerak` HARUS ikut diperiksa, bukan hanya `gerak_sejak`: selama jeda DEBOUNCE
        # gerak_sejak masih terisi walau bingkai saat ini tidak punya kotak sama sekali, dan
        # union bbox di bawah lalu memanggil min() atas urutan kosong. Itu menghentikan seluruh
        # container — terbukti pada uji kedua, setelah 13 detik berjalan normal.
        cukup_lama = (
            bool(kotak_gerak)
            and gerak_sejak is not None
            and sekarang - gerak_sejak >= CONFIRM_SEC
        )
        boleh_gate = sekarang - gate_terakhir >= GATE_COOLDOWN
        if cukup_lama and not event_terbuka and boleh_gate and setelan.aktif:
            gate_terakhir = sekarang
            x1 = max(0, min(b[0] for b in kotak_gerak))
            y1 = max(0, min(b[1] for b in kotak_gerak))
            x2 = min(lebar, max(b[2] for b in kotak_gerak))
            y2 = min(tinggi, max(b[3] for b in kotak_gerak))
            pad_x = int((x2 - x1) * GATE_CROP / 2)
            pad_y = int((y2 - y1) * GATE_CROP / 2)
            ax1, ay1 = max(0, x1 - pad_x), max(0, y1 - pad_y)
            ax2, ay2 = min(lebar, x2 + pad_x), min(tinggi, y2 + pad_y)
            potongan = kerja[ay1:ay2, ax1:ax2]

            # Jalur inferensi adalah satu-satunya bagian yang memanggil pustaka luar dan
            # aritmetika array di dalam loop. Satu bingkai yang bentuknya tak terduga tidak
            # boleh mematikan pemantauan semalaman — dilewati saja, lalu dicatat.
            try:
                temuan = pengonfirmasi.deteksi(
                    potongan, float(setelan["confirm_conf"] or 0.15), setelan.kelas_dikonfirmasi,
                )
            except Exception as e:                         # noqa: BLE001
                log("konfirmasi gagal, bingkai dilewati:", e)
                temuan = []
            deteksi_terakhir = [(n, s, (x + ax1, y + ay1, xx + ax1, yy + ay1))
                                for n, s, (x, y, xx, yy) in temuan]

            if deteksi_terakhir:
                event_terbuka = True
                if datetime.now().date() != hari_ini:
                    hari_ini, event_hari_ini = datetime.now().date(), 0
                event_hari_ini += 1

                anotasi = gambar_penanda(kerja.copy(), setelan, kotak_gerak, deteksi_terakhir)
                ok, sandi = cv2.imencode(".jpg", anotasi, [cv2.IMWRITE_JPEG_QUALITY, 80])
                jpg = sandi.tobytes() if ok else b""
                nama_berkas = datetime.now().strftime("%Y%m%d-%H%M%S") + ".jpg"
                if jpg:
                    try:
                        (dir_snap / nama_berkas).write_bytes(jpg)
                    except OSError as e:
                        log("gagal menyimpan cuplikan:", e)

                daftar = sorted({n for n, _, _ in deteksi_terakhir})
                try:
                    with berkas_event.open("a", encoding="utf-8") as f:
                        f.write(json.dumps({
                            "ts": datetime.now().isoformat(timespec="seconds"),
                            "label": setelan["label"], "area": setelan["area"],
                            "classes": daftar, "snap": nama_berkas,
                        }, ensure_ascii=False) + "\n")
                except OSError as e:
                    log("gagal menulis events.jsonl:", e)

                dalam_jam = setelan.dalam_jam_ronda()
                jeda_tg = float(setelan["tg_cooldown" if dalam_jam else "tg_cooldown_off"] or 12)
                if jpg and sekarang - telegram.terakhir >= jeda_tg:
                    telegram.terakhir = sekarang
                    telegram.foto(
                        setelan["chat_id"], jpg,
                        f"{setelan['label']} ({setelan['area']}) — {', '.join(daftar)}"
                        f"\n{datetime.now():%Y-%m-%d %H:%M:%S}",
                    )
                log(f"event: {', '.join(daftar)} (hari ini: {event_hari_ini})")

        riwayat_fps.append(sekarang)
        if sekarang - tulis_terakhir >= 1.0:
            tulis_terakhir = sekarang
            anotasi = gambar_penanda(kerja.copy(), setelan, kotak_gerak, deteksi_terakhir)
            ok, sandi = cv2.imencode(".jpg", anotasi, [cv2.IMWRITE_JPEG_QUALITY, 75])
            if ok:
                try:
                    tulis_atomik(berkas_pratinjau, sandi.tobytes())
                except OSError as e:
                    log("gagal menulis latest.jpg:", e)
            fps = 0.0
            if len(riwayat_fps) > 1:
                rentang = riwayat_fps[-1] - riwayat_fps[0]
                fps = round((len(riwayat_fps) - 1) / rentang, 1) if rentang > 0 else 0.0
            try:
                tulis_atomik(berkas_status, json.dumps({
                    "ts": datetime.now().isoformat(timespec="seconds"),
                    "events_today": event_hari_ini,
                    "enabled": setelan.aktif,
                    "label": setelan["label"],
                    "area": setelan["area"],
                    "fps": fps,
                    "sumber_terbaca": True,
                    "umur_frame_detik": round(max(0.0, sekarang - stempel), 1),
                    "sambung_ulang": sumber.sambung_ulang,
                    "setelan_dimuat_ulang": setelan.muat_ulang,
                    "model_siap": pengonfirmasi.siap(),
                    "dalam_jam_ronda": setelan.dalam_jam_ronda(),
                    "perubahan_global": bool(global_berubah),
                }, ensure_ascii=False).encode("utf-8"))
            except OSError as e:
                log("gagal menulis status.json:", e)

        if sekarang - rapi_terakhir >= 300:
            rapi_terakhir = sekarang
            rapikan(dir_snap, berkas_event)

        sisa = jeda - (time.time() - putaran)
        if sisa > 0:
            time.sleep(sisa)


if __name__ == "__main__":
    try:
        sys.exit(main() or 0)
    except KeyboardInterrupt:
        sys.exit(0)
