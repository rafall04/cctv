#!/usr/bin/env python3
"""
Titik Speaker agent — RAF NET CCTV Hub.

Runs on a network speaker node (an STB/Armbian box + Class-D amp e.g. TPA3116D2 + TOA horn). It short-polls
the Hub for a play/stop command, downloads the clip as WAV, and plays it out the STB's 3.5mm line-out into
the amp. Auth is the device TOKEN (shown once on the admin "Titik Speaker" page). Pull model = works behind
NAT and keeps retrying when the network hiccups (offline-tolerant).

Dependency-free (Python 3 stdlib only). Playback uses `aplay` (alsa-utils) by default.

CONFIG — env vars, or /etc/rafnet-speaker.conf with KEY=VALUE lines:
  HUB_URL   e.g. https://cctv.contoh.desa      (tanpa garis miring akhir)
  TOKEN     token titik speaker dari halaman admin
  PLAYER    opsional: aplay (default) | mpv | ffplay

RUN:  HUB_URL=... TOKEN=... python3 audio_node.py
Atau pasang sebagai service systemd (contoh unit di bawah, di komentar).

  # /etc/systemd/system/rafnet-speaker.service
  # [Unit]
  # Description=RAF NET Titik Speaker
  # After=network-online.target
  # [Service]
  # ExecStart=/usr/bin/python3 /opt/rafnet/audio_node.py
  # EnvironmentFile=/etc/rafnet-speaker.conf
  # Restart=always
  # RestartSec=3
  # [Install]
  # WantedBy=multi-user.target
"""
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def load_conf():
    conf = {}
    path = os.environ.get('RAFNET_SPEAKER_CONF', '/etc/rafnet-speaker.conf')
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    conf[k.strip()] = v.strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    hub = (os.environ.get('HUB_URL') or conf.get('HUB_URL') or '').rstrip('/')
    token = os.environ.get('TOKEN') or conf.get('TOKEN') or ''
    player = os.environ.get('PLAYER') or conf.get('PLAYER') or 'aplay'
    return hub, token, player


HUB, TOKEN, PLAYER = load_conf()
if not HUB or not TOKEN:
    print('HUB_URL dan TOKEN wajib (env atau /etc/rafnet-speaker.conf)', file=sys.stderr)
    sys.exit(1)

_current = None  # current playback process


def http_get(path, timeout=30):
    req = urllib.request.Request(HUB + path, headers={'x-device-token': TOKEN})
    return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310 (fixed HUB base)


def stop_playback():
    global _current
    if _current and _current.poll() is None:
        try:
            _current.terminate()
        except Exception:
            pass
    _current = None


def play_wav(data, loop):
    global _current
    stop_playback()
    fd, path = tempfile.mkstemp(suffix='.wav')
    os.write(fd, data)
    os.close(fd)
    loop = max(1, min(int(loop or 1), 20))
    if PLAYER == 'mpv':
        cmd = ['mpv', '--no-video', '--really-quiet', '--loop=%d' % loop, path]
    elif PLAYER == 'ffplay':
        cmd = ['sh', '-c', 'for i in $(seq %d); do ffplay -nodisp -autoexit -loglevel quiet "%s"; done' % (loop, path)]
    else:  # aplay (alsa-utils) — plays WAV straight to the sound card
        cmd = ['sh', '-c', 'for i in $(seq %d); do aplay -q "%s"; done' % (loop, path)]
    try:
        _current = subprocess.Popen(cmd)  # noqa: S603
    except Exception as e:
        print('play error:', e, file=sys.stderr)


def main():
    print('[Titik Speaker] agent up -> %s (player=%s)' % (HUB, PLAYER))
    while True:
        try:
            # LONG-poll: the Hub holds this up to ~25s and returns the instant a command is queued, so a
            # clip/adzan/emergency fires in <1s. timeout must exceed the hold window.
            resp = http_get('/api/admin/audio/node/poll', timeout=35)
            body = json.loads(resp.read().decode('utf-8'))
            data = body.get('data') or {}
            cmd = data.get('command')
            if cmd == 'play' and data.get('clip_url'):
                audio = http_get(data['clip_url'], timeout=30).read()
                play_wav(audio, data.get('loop') or 1)
            elif cmd == 'stop':
                stop_playback()
            time.sleep(0.3)  # small floor; the server long-poll provides the real pacing
        except urllib.error.HTTPError as e:
            if e.code == 401:
                print('token ditolak — cek TOKEN', file=sys.stderr)
                time.sleep(10)
            else:
                time.sleep(3)
        except Exception:
            time.sleep(3)  # network hiccup — keep trying


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        stop_playback()
