#!/usr/bin/env python3
"""
Purpose: LIVE variant of the backchannel pusher for push-to-talk (PTT). Reads G.711 u-law frames
         (320 bytes = 20ms @ 16kHz) from STDIN and streams them to a camera's ONVIF speaker in real time.
         Reuses the PROVEN RtspTalk handshake from audio_cast.py (anti-drift) — only the frame SOURCE
         changes (a live jitter-buffer fed by stdin, instead of a file).
Caller:  backend audioTalkService (spawned per talk session; creds via ENV; frames piped to stdin).
Input:   env CAM_IP, CAM_USER, CAM_PASS, optional CAM_PORT; stdin = raw u-law frames (any chunking).
Output:  prints 'READY' to stdout once the backchannel is open. Exit 0 on clean stop (stdin EOF).

The loop is CLOCK-paced (one 20ms frame every 20ms, never data-paced). When the jitter buffer starves
(mic paused / a late frame / a network hiccup) it sends u-law SILENCE (0xFF) so the RTP timeline never
stops — a gap would make the camera's jitter buffer underflow and tear down the backchannel. A bounded
buffer drops the oldest frames under overrun (live audio favours freshness over completeness).
"""
import os
import sys
import struct
import time
import threading

from audio_cast import RtspTalk  # reuse DESCRIBE(proto=Onvif)+SETUP trackID=5+RECORD+TEARDOWN, byte-identical

CAM_IP = os.environ.get('CAM_IP', '')
CAM_USER = os.environ.get('CAM_USER', 'admin')
CAM_PASS = os.environ.get('CAM_PASS', '')
CAM_PORT = int(os.environ.get('CAM_PORT', '554'))

PT = 103                 # PCMU/16000, same as the file pusher
SAMPLES = 320            # 20ms @ 16kHz (1 byte/sample u-law)
INTERVAL = 0.02
SILENCE = bytes([0xFF]) * SAMPLES     # u-law digital silence
HIGH_WATER = SAMPLES * 12             # ~240ms; beyond this we drop oldest to bound latency
KEEP_ON_OVERRUN = SAMPLES * 4         # trim back to ~80ms
MAX_SESSION_SEC = 300                 # hard cap (backstop; the bridge also enforces one)

_buf = bytearray()
_lock = threading.Lock()
_eof = threading.Event()


def _reader():
    """Fill the jitter buffer from stdin until EOF (the bridge closing stdin = stop)."""
    while True:
        chunk = sys.stdin.buffer.read(SAMPLES)
        if not chunk:
            _eof.set()
            return
        with _lock:
            _buf.extend(chunk)
            if len(_buf) > HIGH_WATER:
                del _buf[:len(_buf) - KEEP_ON_OVERRUN]   # drop oldest, keep newest (freshness)


def main():
    if not CAM_IP:
        print('ERR: CAM_IP required', file=sys.stderr)
        return 2
    talk = None
    try:
        talk = RtspTalk(CAM_IP, CAM_PORT, CAM_USER, CAM_PASS)
        talk.open()   # raises if no backchannel; otherwise RECORD is live
    except Exception as e:
        print('ERR open: %s' % e, file=sys.stderr)
        if talk:
            talk.close()
        return 4

    print('READY', flush=True)
    threading.Thread(target=_reader, daemon=True).start()

    seqn = 0
    ts = 0
    ssrc = 0x43435456
    start = time.time()
    i = 0
    try:
        while True:
            with _lock:
                if len(_buf) >= SAMPLES:
                    frame = bytes(_buf[:SAMPLES])
                    del _buf[:SAMPLES]
                    empty = len(_buf) < SAMPLES
                else:
                    frame = SILENCE
                    empty = True
            rtp = struct.pack('!BBHII', 0x80, PT, seqn & 0xFFFF, ts, ssrc) + frame
            talk.sock.sendall(b'$' + bytes([0]) + struct.pack('!H', len(rtp)) + rtp)
            seqn += 1
            ts += SAMPLES
            i += 1
            # Stop shortly after stdin EOF drains — send a brief silence linger, then TEARDOWN.
            if _eof.is_set() and empty and i > 0:
                break
            if (time.time() - start) > MAX_SESSION_SEC:
                break
            delay = start + i * INTERVAL - time.time()
            if delay > 0:
                time.sleep(delay)
        # ~200ms silence linger so the last word is not clipped by an abrupt TEARDOWN.
        for _ in range(10):
            rtp = struct.pack('!BBHII', 0x80, PT, seqn & 0xFFFF, ts, ssrc) + SILENCE
            talk.sock.sendall(b'$' + bytes([0]) + struct.pack('!H', len(rtp)) + rtp)
            seqn += 1
            ts += SAMPLES
            time.sleep(INTERVAL)
        return 0
    except Exception as e:
        print('ERR stream: %s' % e, file=sys.stderr)
        return 5
    finally:
        if talk:
            talk.close()


if __name__ == '__main__':
    sys.exit(main())
