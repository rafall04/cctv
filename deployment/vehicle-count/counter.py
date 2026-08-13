"""Penghitung kendaraan LIVE — satu proses per kamera, seluruh setelannya dari panel admin.

Dijalankan sebagai `counter.py <camera_id>`; seluruh setelan dibaca dari
<VEHICLE_COUNT_CONFIG_DIR>/cam<id>.json yang ditulis panel admin.

Yang penting dari rancangan ini (semuanya hasil pengukuran, bukan tebakan):
  * Garis disimpan sebagai PROPORSI 0-1, diubah ke piksel saat dipakai. Setelan yang digambar
    admin tetap benar walau sumber berganti resolusi.
  * Config dimuat ULANG saat berkasnya berubah, TANPA memulai proses: memulai ulang berarti
    stream beranotasi mati beberapa detik dan penonton di halaman publik melihat kotaknya
    hilang. Ganti model pun dilakukan di tempat.
  * Satu kendaraan dihitung SEKALI, pada garis pertama yang ia lewati; menambah garis
    menambah cakupan, bukan jumlah.
  * imgsz 384-512 mengalahkan 640 pada CCTV ini - memperbesar input MERUSAK (terbukti pada
    bus.jpg bawaan ultralytics: 0.96 -> 0.26).
  * ByteTrack bawaan (new_track_thresh 0.25) membuang motor malam yang muncul di 0.15-0.40;
    ambangnya diturunkan di bytetrack_malam.yaml.
  * Syarat gerak memakai PERPINDAHAN BERSIH, bukan panjang lintasan: deteksi diam yang
    kotaknya bergetar 2 px/frame bisa mengumpulkan panjang lintasan sampai lolos.
"""
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone

import cv2
import numpy as np
from ultralytics import YOLO

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from livesrc import EncoderPipe, LiveSource, PengawasKemajuan, W, H

AKAR = os.path.dirname(os.path.abspath(__file__))
CONFIG_DIR = os.environ.get('VEHICLE_COUNT_CONFIG_DIR', f'{AKAR}/config')
STATE_DIR = os.environ.get('VEHICLE_COUNT_STATE_DIR', f'{AKAR}/state')
HLS_BASE = os.environ.get('VEHICLE_COUNT_HLS_DIR', f'{AKAR}/web/hls')

URUT = ['motor', 'mobil', 'truk', 'bus']
VEH_COCO = {2: 'mobil', 3: 'motor', 5: 'bus', 7: 'truk'}
COL = {'mobil': (255, 170, 40), 'motor': (80, 235, 120),
       'bus': (220, 90, 255), 'truk': (60, 190, 255)}
WIB = timezone(timedelta(hours=7))
MIN_UMUR_BAWAAN = 3


def peta_kelas(model):
    """Peta indeks kelas -> nama Indonesia, dibaca dari modelnya sendiri.

    Model hasil latihan khusus punya 4 kelas nama Indonesia, model COCO punya 80 nama Inggris.
    Dideteksi otomatis supaya menukar model tidak pernah diam-diam salah memasangkan indeks.
    """
    nama = {int(i): str(n).lower() for i, n in model.names.items()}
    khusus = {i: n for i, n in nama.items() if n in URUT}
    return khusus if len(khusus) == 4 else dict(VEH_COCO)


class Setelan:
    """Config kamera + turunannya dalam piksel. Dimuat ulang saat berkasnya berubah."""

    def __init__(self, cam_id):
        self.cam_id = int(cam_id)
        self.berkas = os.path.join(CONFIG_DIR, f'cam{self.cam_id}.json')
        self.mtime = 0.0
        self.data = {}
        self.muat(paksa=True)

    def berubah(self):
        try:
            return os.path.getmtime(self.berkas) != self.mtime
        except OSError:
            return False

    def muat(self, paksa=False):
        if not paksa and not self.berubah():
            return False
        with open(self.berkas, encoding='utf-8') as f:
            self.data = json.load(f)
        self.mtime = os.path.getmtime(self.berkas)
        return True

    # --- nilai turunan ---
    @property
    def aktif(self):
        return bool(self.data.get('aktif'))

    @property
    def sumber(self):
        return self.data.get('sumber') or ''

    @property
    def garis_px(self):
        """Proporsi 0-1 -> piksel. Ini yang dipakai uji perlintasan."""
        keluar = []
        for g in self.data.get('garis', []):
            try:
                a = (int(g['a'][0] * W), int(g['a'][1] * H))
                b = (int(g['b'][0] * W), int(g['b'][1] * H))
            except (KeyError, TypeError, IndexError):
                continue
            keluar.append((a, b, str(g.get('nama') or '')))
        return keluar

    @property
    def arah_arus(self):
        a = self.data.get('arah_arus') or [1, 0]
        n = float(np.hypot(a[0], a[1])) or 1.0
        return (a[0] / n, a[1] / n)

    @property
    def nama_arah(self):
        na = self.data.get('nama_arah') or {}
        return {'+': na.get('plus') or 'Arah A', '-': na.get('minus') or 'Arah B'}

    def ambil(self, kunci, bawaan):
        nilai = self.data.get(kunci)
        return bawaan if nilai is None else nilai


def sisi(p, a, b):
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])


def dalam_ruas(p0, p1, s0, s1, a, b):
    t = s0 / (s0 - s1)
    X = p0[0] + t * (p1[0] - p0[0])
    Y = p0[1] + t * (p1[1] - p0[1])
    tt = ((X - a[0]) * (b[0] - a[0]) + (Y - a[1]) * (b[1] - a[1])) / \
         ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 + 1e-9)
    return 0.0 <= tt <= 1.0


class Penghitung:
    def __init__(self, cam_id, nama_arah):
        self.nama_arah = nama_arah
        self.total = {a: Counter() for a in ('+', '-')}
        self.per_menit = defaultdict(lambda: {a: Counter() for a in ('+', '-')})
        self.kejadian = deque(maxlen=40)
        self.riwayat = deque(maxlen=200)
        os.makedirs(os.path.join(AKAR, 'out'), exist_ok=True)
        self.csv = open(os.path.join(AKAR, 'out', f'kejadian-cam{cam_id}.csv'), 'a', buffering=1)
        if self.csv.tell() == 0:
            self.csv.write('waktu_wib,jenis,arah,id_trek,x,y\n')

    def catat(self, jenis, arah, tid, pos):
        t = datetime.now(WIB)
        self.total[arah][jenis] += 1
        self.per_menit[t.strftime('%H:%M')][arah][jenis] += 1
        self.kejadian.appendleft({'waktu': t.strftime('%H:%M:%S'), 'jenis': jenis,
                                  'arah': self.nama_arah[arah], 'id': tid})
        self.csv.write(f'{t.strftime("%Y-%m-%d %H:%M:%S")},{jenis},{self.nama_arah[arah]},'
                       f'{tid},{int(pos[0])},{int(pos[1])}\n')


def gambar_panel(vis, ctr, fps, mulai, restarts, setel):
    ov = vis.copy()
    cv2.rectangle(ov, (0, 0), (250, 200), (18, 18, 22), -1)
    cv2.rectangle(ov, (0, H - 30), (W, H), (18, 18, 22), -1)
    vis[:] = cv2.addWeighted(ov, 0.72, vis, 0.28, 0)
    cv2.putText(vis, 'HITUNG KENDARAAN - LIVE', (10, 20),
                cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1, cv2.LINE_AA)
    y = 42
    for arah in ('+', '-'):
        warna = (120, 255, 190) if arah == '+' else (140, 190, 255)
        cv2.putText(vis, setel.nama_arah[arah][:30].upper(), (10, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.34, warna, 1, cv2.LINE_AA)
        y += 16
        for jenis in URUT:
            cv2.putText(vis, f'{jenis:>6s}', (18, y), cv2.FONT_HERSHEY_SIMPLEX,
                        0.38, COL[jenis], 1, cv2.LINE_AA)
            cv2.putText(vis, f'{ctr.total[arah][jenis]:4d}', (92, y),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
            y += 15
        cv2.putText(vis, f'total {sum(ctr.total[arah].values())}', (18, y),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1, cv2.LINE_AA)
        y += 22
    lama = int(time.time() - mulai)
    cv2.putText(vis, f'{datetime.now(WIB).strftime("%d-%m-%Y %H:%M:%S WIB")}   |   {fps:.1f} fps'
                     f'   |   {setel.ambil("model", "?")} imgsz={setel.ambil("imgsz", 448)}'
                     f'   |   aktif {lama//3600:02d}:{(lama%3600)//60:02d}:{lama%60:02d}'
                     f'   |   sambung ulang: {restarts}',
                (12, H - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.44, (210, 210, 210), 1, cv2.LINE_AA)


def buat_encoder(hls_dir, fps):
    os.makedirs(hls_dir, exist_ok=True)
    for f in os.listdir(hls_dir):
        try:
            os.remove(os.path.join(hls_dir, f))
        except OSError:
            pass
    return EncoderPipe([
        'ffmpeg', '-hide_banner', '-loglevel', 'error',
        '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', f'{W}x{H}', '-r', str(fps), '-i', '-',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p', '-g', str(fps * 2), '-b:v', '1800k',
        # Jendela lebar + cap jam nyata. Jendela sempit (6 segmen) mulus di LAN tapi MACET
        # lewat Cloudflare; program_date_time yang membuat panel bisa diselaraskan ke detik
        # yang sedang ditonton.
        '-f', 'hls', '-hls_time', '2', '-hls_list_size', '20', '-hls_delete_threshold', '10',
        '-hls_flags', 'delete_segments+omit_endlist+independent_segments+program_date_time',
        f'{hls_dir}/live.m3u8',
    ])


def main():
    if len(sys.argv) < 2:
        print('pemakaian: counter.py <camera_id>', flush=True)
        sys.exit(2)
    cam_id = int(sys.argv[1])

    setel = Setelan(cam_id)
    if not setel.aktif:
        print(f'[cam{cam_id}] setelan tidak aktif - berhenti', flush=True)
        sys.exit(0)
    if not setel.sumber:
        print(f'[cam{cam_id}] tidak ada alamat sumber - berhenti', flush=True)
        sys.exit(1)

    os.makedirs(STATE_DIR, exist_ok=True)
    stats_path = os.path.join(STATE_DIR, f'cam{cam_id}.json')
    hls_dir = os.path.join(HLS_BASE, str(cam_id))

    model_nama = setel.ambil('model', 'yolo11m.pt')
    model = YOLO(os.path.join(AKAR, model_nama))
    VEH = peta_kelas(model)
    fps = int(setel.ambil('fps', 8))
    src = LiveSource(setel.sumber, fps=fps).start()
    enc = buat_encoder(hls_dir, fps)
    awas = PengawasKemajuan(batas_detik=150.0)
    ctr = Penghitung(cam_id, setel.nama_arah)

    print(f'[cam{cam_id}] {model_nama} imgsz={setel.ambil("imgsz", 448)} | '
          f'{len(setel.garis_px)} garis | kelas {VEH}', flush=True)

    jejak = {}
    mulai = time.time()
    n = 0
    t_fps = time.time()
    fps_ukur = 0.0
    t_tulis = 0.0
    muat_ulang = 0

    for frame in src.frames():
        # --- muat ulang setelan tanpa memulai proses ---
        if n % 40 == 0 and setel.berubah():
            try:
                setel.muat()
                muat_ulang += 1
                ctr.nama_arah = setel.nama_arah
                if not setel.aktif:
                    print(f'[cam{cam_id}] dimatikan lewat panel - berhenti', flush=True)
                    break
                baru = setel.ambil('model', model_nama)
                if baru != model_nama:
                    model = YOLO(os.path.join(AKAR, baru))
                    VEH = peta_kelas(model)
                    model_nama = baru
                    print(f'[cam{cam_id}] model diganti -> {baru} {VEH}', flush=True)
                print(f'[cam{cam_id}] setelan dimuat ulang '
                      f'({len(setel.garis_px)} garis)', flush=True)
            except Exception as e:                       # noqa: BLE001
                print(f'[cam{cam_id}] setelan baru tidak terbaca, memakai yang lama: {e}',
                      flush=True)

        garis = setel.garis_px
        arah_arus = setel.arah_arus
        conf_gambar = float(setel.ambil('conf_gambar', 0.35))
        min_gerak = float(setel.ambil('min_gerak', 45))
        min_umur = int(setel.ambil('min_umur', MIN_UMUR_BAWAAN))

        res = model.track(frame, persist=True,
                          tracker=os.path.join(AKAR, 'bytetrack_malam.yaml'),
                          classes=list(VEH), conf=float(setel.ambil('conf', 0.10)),
                          imgsz=int(setel.ambil('imgsz', 448)),
                          agnostic_nms=True, verbose=False)[0]
        vis = frame.copy()

        for i, (ga, gb, nama) in enumerate(garis):
            cv2.line(vis, ga, gb, (0, 255, 255), 2)
            cv2.putText(vis, nama or f'GARIS {i + 1}', (ga[0] + 6, max(16, ga[1] - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1, cv2.LINE_AA)
        if garis:
            m = ((garis[0][0][0] + garis[0][1][0]) // 2, (garis[0][0][1] + garis[0][1][1]) // 2)
            cv2.arrowedLine(vis, m, (int(m[0] + arah_arus[0] * 70), int(m[1] + arah_arus[1] * 70)),
                            (120, 255, 190), 2, tipLength=0.35)

        hidup = set()
        if res.boxes.id is not None:
            kotak = res.boxes.xyxy.tolist()
            skor = res.boxes.conf.tolist()
            # Kendaraan panjang sering dapat dua kotak (kabin + bak) yang lolos NMS karena IoU
            # kotak bersarang rendah; tanpa ini satu truk bisa terhitung dua kali.
            tenggelam = set()
            for i in range(len(kotak)):
                ax1, ay1, ax2, ay2 = kotak[i]
                luas_i = max((ax2 - ax1) * (ay2 - ay1), 1e-9)
                for k in range(len(kotak)):
                    if i == k or i in tenggelam:
                        continue
                    bx1, by1, bx2, by2 = kotak[k]
                    iw = max(0.0, min(ax2, bx2) - max(ax1, bx1))
                    ih = max(0.0, min(ay2, by2) - max(ay1, by1))
                    if iw > 0 and ih > 0 and (iw * ih) / luas_i > 0.75 and skor[k] >= skor[i]:
                        tenggelam.add(i)
                        break

            for ii, (box, tid, cl, cf) in enumerate(
                    zip(kotak, res.boxes.id.tolist(), res.boxes.cls.tolist(),
                        res.boxes.conf.tolist())):
                tid = int(tid)
                hidup.add(tid)
                if ii in tenggelam:
                    continue
                cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
                j = jejak.get(tid)
                if j is None:
                    j = jejak[tid] = {'pos': (cx, cy), 'awal': (cx, cy),
                                      'vote': Counter(), 'umur': 0, 'gerak': 0.0, 'sudah': False}
                else:
                    j['gerak'] = float(np.hypot(cx - j['awal'][0], cy - j['awal'][1]))
                j['vote'][VEH[int(cl)]] += 1
                j['umur'] += 1
                jenis = j['vote'].most_common(1)[0][0]

                if not j['sudah'] and j['umur'] >= min_umur and j['gerak'] >= min_gerak:
                    for (ga, gb, _n) in garis:
                        s0 = sisi(j['pos'], ga, gb)
                        s1 = sisi((cx, cy), ga, gb)
                        if s0 == 0 or s1 == 0 or (s0 < 0) == (s1 < 0):
                            continue
                        if not dalam_ruas(j['pos'], (cx, cy), s0, s1, ga, gb):
                            continue
                        dx, dy = cx - j['pos'][0], cy - j['pos'][1]
                        arah = '+' if (dx * arah_arus[0] + dy * arah_arus[1]) > 0 else '-'
                        ctr.catat(jenis, arah, tid, (cx, cy))
                        j['sudah'] = True
                        cv2.circle(vis, (int(cx), int(cy)), 18, (0, 255, 255), 3)
                        break
                j['pos'] = (cx, cy)

                if cf >= conf_gambar:
                    c = COL[jenis]
                    cv2.rectangle(vis, (int(box[0]), int(box[1])),
                                  (int(box[2]), int(box[3])), c, 2)
                    cv2.putText(vis, f'{jenis} {cf:.2f}', (int(box[0]), int(box[1]) - 5),
                                cv2.FONT_HERSHEY_SIMPLEX, 0.4, c, 1, cv2.LINE_AA)

        if len(jejak) > 400:
            for tid in [t for t in list(jejak) if t not in hidup and jejak[t]['sudah']][:200]:
                del jejak[tid]

        n += 1
        if n % 10 == 0:
            fps_ukur = 10.0 / max(time.time() - t_fps, 1e-6)
            t_fps = time.time()

        gambar_panel(vis, ctr, fps_ukur, mulai, src.restarts, setel)
        enc.write(vis.tobytes())
        awas.detak()

        if time.time() - t_tulis > 1.0:
            t_tulis = time.time()
            menit = sorted(ctr.per_menit.keys())[-30:]
            sekarang = datetime.now(WIB)
            kunci10 = [(sekarang - timedelta(minutes=i)).strftime('%H:%M') for i in range(10)]
            total10 = Counter()
            for k in kunci10:
                if k in ctr.per_menit:
                    for a in ('+', '-'):
                        total10.update(ctr.per_menit[k][a])

            data = {
                'camera_id': cam_id,
                'kamera': setel.ambil('label', f'Kamera {cam_id}'),
                'diperbarui': sekarang.strftime('%Y-%m-%d %H:%M:%S WIB'),
                'mulai': datetime.fromtimestamp(mulai, WIB).strftime('%Y-%m-%d %H:%M:%S WIB'),
                'detik_aktif': int(time.time() - mulai),
                'fps': round(fps_ukur, 1),
                'model': f'{model_nama} imgsz={setel.ambil("imgsz", 448)}',
                'frame_diproses': n,
                'sambung_ulang': src.restarts,
                'umur_frame_terakhir_detik': round(time.time() - src.last_frame_at, 1),
                'frame_dijatuhkan_sumber': src.frames_dropped,
                'frame_dijatuhkan_encoder': enc.dropped,
                'encoder_lahir_ulang': enc.respawns,
                'setelan_dimuat_ulang': muat_ulang,
                'jumlah_garis': len(garis),
                'arah': {setel.nama_arah[a]: {j: ctr.total[a][j] for j in URUT}
                         for a in ('+', '-')},
                'total_jenis': {j: ctr.total['+'][j] + ctr.total['-'][j] for j in URUT},
                'total': sum(ctr.total['+'].values()) + sum(ctr.total['-'].values()),
                'total_10_menit': sum(total10.values()),
                'per_jenis_10_menit': {j: total10[j] for j in URUT},
                'per_menit': [{'menit': m,
                               'ke_barat': sum(ctr.per_menit[m]['+'].values()),
                               'ke_timur': sum(ctr.per_menit[m]['-'].values())}
                              for m in menit],
                'kejadian_terakhir': list(ctr.kejadian)[:15],
            }
            ctr.riwayat.append({
                't': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                'total': data['total'],
                'jenis': dict(data['total_jenis']),
                'arah': {setel.nama_arah[a]: sum(ctr.total[a].values()) for a in ('+', '-')},
            })
            data['riwayat'] = list(ctr.riwayat)

            tmp = stats_path + '.tmp'
            with open(tmp, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=1)
            os.replace(tmp, stats_path)

    src.close()
    enc.close()


if __name__ == '__main__':
    main()
