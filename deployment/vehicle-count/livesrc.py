"""Sumber frame LIVE dari HLS lewat pipa ffmpeg, tahan terhadap stream yang MENGGANTUNG.

Kenapa ditulis ulang (insiden 2026-08-13): penghitung diam 5,5 jam padahal systemd
melaporkan `active` dan `NRestarts=0`. Buktinya: thread utama tidur di `pipe_read` dengan
0 tick CPU, sementara ffmpeg pembacanya masih hidup tapi tak mengirim satu byte pun selama
8 jam. Koneksi TCP-nya tidak pernah dianggap putus, jadi `-reconnect` tak pernah kena dan
`stdout.read()` menunggu selamanya.

Pelajarannya: `Restart=always` hanya menyelamatkan proses yang MATI, bukan yang MENGGANTUNG.
Yang menjadi ukuran kesehatan haruslah KEMAJUAN (frame terakhir kapan), bukan keberadaan proses.

Rancangan:
  * Pembacaan pipa pindah ke thread sendiri -> blocking read tidak lagi membekukan pemakainya.
  * Thread pengawas membunuh ffmpeg bila tak ada frame melewati `frame_timeout`; read pun
    langsung mengembalikan EOF, loop pembaca berputar, ffmpeg dilahirkan ulang.
  * Antrean berbatas dengan buang-yang-terlama: kalau inferensi tertinggal, yang dijatuhkan
    adalah frame lama, bukan kesegaran tayangan.
"""
import os
import queue
import subprocess
import threading
import time

import numpy as np

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36')
W, H = 1280, 720
FRAME_BYTES = W * H * 3


class LiveSource:
    # Antrean HARUS memuat satu gelombang penuh. HLS mengirim per segmen ~2 detik, jadi
    # ffmpeg memuntahkan ~fps*2 frame sekaligus lalu diam menunggu segmen berikutnya.
    # Dengan antrean 4 (nilai lama), 12 dari 16 frame tiap gelombang dibuang dan pemakainya
    # kelaparan sampai gelombang berikutnya - laju terkunci 2 fps meski inferensi sanggup 8,8 fps.
    # Terukur 2026-08-13: 72% waktu habis MENUNGGU padahal 556 frame dibuang di saat yang sama.
    def __init__(self, url, fps=8, log=print, frame_timeout=25.0, antrean=48):
        self.url, self.fps, self.log = url, fps, log
        self.frame_timeout = frame_timeout
        self.restarts = 0
        self.frames_dropped = 0
        self.last_frame_at = time.time()
        self._q = queue.Queue(maxsize=antrean)
        self._proc = None
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._loop_baca, daemon=True)
        self._watch = threading.Thread(target=self._loop_awas, daemon=True)

    # ---------- internal ----------
    def _spawn(self):
        return subprocess.Popen(
            ['ffmpeg', '-hide_banner', '-loglevel', 'error',
             '-user_agent', UA,
             # Batas waktu di sisi ffmpeg juga (mikrodetik). Ini lapis pertama;
             # pengawas di bawah tetap ada karena opsi ini tidak menangkap semua kasus macet.
             '-rw_timeout', '15000000',
             '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
             '-i', self.url,
             '-an', '-vf', f'fps={self.fps},scale={W}:{H}',
             '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-'],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=FRAME_BYTES)

    def _bunuh(self, proc):
        if proc is None:
            return
        try:
            proc.kill()
            proc.wait(timeout=5)
        except Exception:
            pass

    def _loop_baca(self):
        while not self._stop.is_set():
            self._proc = self._spawn()
            self.last_frame_at = time.time()
            while not self._stop.is_set():
                buf = self._proc.stdout.read(FRAME_BYTES)
                if not buf or len(buf) < FRAME_BYTES:
                    break                      # EOF, atau pengawas baru saja membunuhnya
                self.last_frame_at = time.time()
                try:
                    self._q.put_nowait(buf)
                except queue.Full:
                    # Buang yang TERLAMA, simpan yang terbaru: kalau inferensi tertinggal,
                    # yang penting tayangan tetap mutakhir, bukan antre panjang.
                    try:
                        self._q.get_nowait()
                        self.frames_dropped += 1
                    except queue.Empty:
                        pass
                    try:
                        self._q.put_nowait(buf)
                    except queue.Full:
                        pass
            self._bunuh(self._proc)
            self._proc = None
            if not self._stop.is_set():
                self.restarts += 1
                self.log(f'[live] stream berhenti mengirim, dilahirkan ulang '
                         f'(ke-{self.restarts})')
                time.sleep(2)

    def _loop_awas(self):
        """Membunuh ffmpeg yang diam. Inilah yang absen saat insiden 5,5 jam itu."""
        while not self._stop.is_set():
            time.sleep(2)
            diam = time.time() - self.last_frame_at
            if diam > self.frame_timeout and self._proc is not None:
                self.log(f'[live] tidak ada frame {diam:.0f} dtk - ffmpeg dibunuh paksa')
                self._bunuh(self._proc)

    # ---------- publik ----------
    def start(self):
        self._reader.start()
        self._watch.start()
        return self

    def frames(self):
        """Yield frame bgr24 tanpa henti. Tidak pernah menggantung selamanya."""
        if not self._reader.is_alive():
            self.start()
        while not self._stop.is_set():
            try:
                buf = self._q.get(timeout=5)
            except queue.Empty:
                continue        # pengawas sedang menangani; jangan bikin loop mati
            yield np.frombuffer(buf, dtype='uint8').reshape(H, W, 3)

    def close(self):
        self._stop.set()
        self._bunuh(self._proc)


class EncoderPipe:
    """Pipa ke ffmpeg encoder yang TIDAK PERNAH memblokir pemanggilnya.

    Menulis langsung ke `proc.stdin` berbahaya: begitu encoder tersendat, buffer pipa penuh
    dan `write()` menggantung - membekukan seluruh penghitungan hanya karena tayangan macet.
    Padahal prioritasnya terbalik: ANGKA harus tetap jalan meski video keluaran tersendat.

    Jadi penulisan dipindah ke thread dengan antrean berbatas; antrean penuh = frame dijatuhkan.
    """

    def __init__(self, cmd, maxsize=8, log=print):
        self.cmd, self.log = cmd, log
        self.q = queue.Queue(maxsize=maxsize)
        self.dropped = 0
        self.respawns = 0
        self.proc = None
        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def _spawn(self):
        self.proc = subprocess.Popen(self.cmd, stdin=subprocess.PIPE,
                                     stderr=subprocess.DEVNULL)

    def write(self, data):
        try:
            self.q.put_nowait(data)
        except queue.Full:
            self.dropped += 1

    def _loop(self):
        self._spawn()
        while not self._stop.is_set():
            try:
                data = self.q.get(timeout=2)
            except queue.Empty:
                continue
            try:
                self.proc.stdin.write(data)
            except Exception:
                self.respawns += 1
                self.log(f'[enc] encoder tumbang, dilahirkan ulang (ke-{self.respawns})')
                try:
                    self.proc.kill()
                except Exception:
                    pass
                time.sleep(1)
                self._spawn()

    def close(self):
        self._stop.set()
        try:
            self.proc.kill()
        except Exception:
            pass


class PengawasKemajuan:
    """Palang terakhir: kalau LOOP UTAMA yang macet (mis. penulisan encoder terblokir),
    tidak ada gunanya menunggu - keluar keras supaya systemd menghidupkan ulang.

    Sengaja `os._exit`: proses sedang macet, jadi jalur keluar yang sopan pun bisa ikut macet.
    """

    def __init__(self, batas_detik=150.0, log=print):
        self.batas = batas_detik
        self.log = log
        self.denyut = time.time()
        threading.Thread(target=self._loop, daemon=True).start()

    def detak(self):
        self.denyut = time.time()

    def _loop(self):
        while True:
            time.sleep(5)
            diam = time.time() - self.denyut
            if diam > self.batas:
                self.log(f'[awas] loop utama diam {diam:.0f} dtk - keluar paksa '
                         f'agar systemd menghidupkan ulang')
                os._exit(1)
