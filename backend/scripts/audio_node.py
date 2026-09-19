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
  CACHE_DIR opsional: direktori cache clip (default /var/cache/rafnet-speaker)

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


AGENT_VERSION = '1.1.0'

HUB, TOKEN, PLAYER = load_conf()
if not HUB or not TOKEN:
    print('HUB_URL dan TOKEN wajib (env atau /etc/rafnet-speaker.conf)', file=sys.stderr)
    sys.exit(1)

CACHE_DIR = os.environ.get('CACHE_DIR') or '/var/cache/rafnet-speaker'
CACHE_MAX_BYTES = 200 * 1024 * 1024  # keep the newest clips; prune LRU beyond this

_current = None  # current playback process


def http_get(path, timeout=30):
    # x-agent-version lets the admin list show which nodes run an old agent (field ops hygiene).
    req = urllib.request.Request(HUB + path, headers={'x-device-token': TOKEN, 'x-agent-version': AGENT_VERSION})
    return urllib.request.urlopen(req, timeout=timeout)  # noqa: S310 (fixed HUB base)


def clip_cache_path(clip_id):
    return os.path.join(CACHE_DIR, 'clip_%s.wav' % clip_id)


def prune_cache():
    """LRU-prune the clip cache: a node that loops the same adzan daily must not grow forever."""
    try:
        entries = []
        total = 0
        for name in os.listdir(CACHE_DIR):
            p = os.path.join(CACHE_DIR, name)
            if not (name.startswith('clip_') and name.endswith('.wav') and os.path.isfile(p)):
                continue
            st = os.stat(p)
            entries.append((st.st_mtime, st.st_size, p))
            total += st.st_size
        for _, size, p in sorted(entries):  # oldest mtime first
            if total <= CACHE_MAX_BYTES:
                break
            try:
                os.remove(p)
                total -= size
            except OSError:
                pass
    except OSError:
        pass  # cache dir missing/unreadable — non-fatal, playback still works uncached


def fetch_clip(clip_url):
    """Return WAV bytes — from the local cache when this clip was already downloaded (daily adzan
    doesn't re-download every time), else fetch and cache it. Cache key = clip_id from the URL tail."""
    clip_id = clip_url.rstrip('/').rsplit('/', 1)[-1]
    cached = clip_cache_path(clip_id)
    try:
        if os.path.getsize(cached) > 0:
            os.utime(cached)  # touch: most-recently-played survives LRU pruning
            with open(cached, 'rb') as f:
                return f.read()
    except OSError:
        pass
    data = http_get(clip_url, timeout=30).read()
    try:
        os.makedirs(CACHE_DIR, exist_ok=True)
        tmp = cached + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(data)
        os.replace(tmp, cached)
        prune_cache()
    except OSError:
        pass  # read-only fs / no space — play uncached
    return data


def set_volume(level):
    """amixer volume 0-100. HG680P/Armbian exposes the line-out under different control names
    depending on the DTB, so try the common ones and stop at the first that answers."""
    level = max(0, min(int(level), 100))
    for ctl in ('Master', 'PCM', 'Lineout', 'HDMI', 'DAC'):
        r = subprocess.call(['amixer', '-q', 'sset', ctl, '%d%%' % level],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)  # noqa: S603,S607
        if r == 0:
            print('volume %d%% -> %s' % (level, ctl))
            return
    print('volume: tak ada kontrol amixer yang cocok', file=sys.stderr)


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


def play_stream(path):
    """Live push-to-talk: play the Hub's raw u-law 16k stream via `aplay -f MU_LAW` until EOF/idle.
    A ~12s per-read timeout self-heals a stale stream (no audio) so the agent resumes polling."""
    global _current
    stop_playback()
    try:
        resp = http_get(path, timeout=12)
    except Exception:
        return
    try:
        p = subprocess.Popen(['aplay', '-q', '-t', 'raw', '-f', 'MU_LAW', '-c', '1', '-r', '16000'], stdin=subprocess.PIPE)  # noqa: S603,S607
    except Exception as e:
        print('aplay error:', e, file=sys.stderr)
        try:
            resp.close()
        except Exception:
            pass
        return
    _current = p
    try:
        while True:
            chunk = resp.read(320)  # ~20ms u-law frame
            if not chunk:
                break  # talk ended (Hub closed the stream)
            try:
                p.stdin.write(chunk)
            except Exception:
                break
    except Exception:
        pass  # idle timeout / network drop -> end this talk, go back to polling
    finally:
        try:
            p.stdin.close()
        except Exception:
            pass
        try:
            resp.close()
        except Exception:
            pass


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
                audio = fetch_clip(data['clip_url'])
                play_wav(audio, data.get('loop') or 1)
            elif cmd == 'talk_start' and data.get('stream_url'):
                play_stream(data['stream_url'])  # blocks (plays live) until talk ends, then resume polling
            elif cmd == 'volume' and data.get('level') is not None:
                set_volume(data['level'])
            elif cmd in ('stop', 'talk_end'):
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
