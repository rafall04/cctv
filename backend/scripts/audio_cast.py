#!/usr/bin/env python3
"""
Purpose: Stream one or more pre-encoded G.711 (u-law 16kHz mono) audio files to an ONVIF camera's
         speaker via the ONVIF/Dahua RTSP backchannel. Used by the Audio Broadcast feature.
Caller:  backend audioCastService (spawned as a child process, one run per play).
Input:   env CAM_IP, CAM_USER, CAM_PASS, optional CAM_PORT (default 554);
         argv[1:] = list of .ulaw files (16kHz mono u-law) to play in sequence (a playlist).
         optional env LOOP=<n> repeats the whole sequence n times (default 1).
Why Python + this mechanism: the ONVIF backchannel handshake (proto=Onvif stream URI + Require header
         -> a sendonly audio track -> SETUP/RECORD -> interleaved RTP) was proven working on IMOU
         IPC-PS3E. Codec: u-law payload type 103 (PCMU/16000) for clearer voice/music than 8kHz.
Exit:    0 on success (all files streamed), non-zero on any hard failure. Status lines to stdout.
"""
import os
import re
import sys
import socket
import struct
import hashlib
import time

CAM_IP = os.environ.get('CAM_IP', '')
CAM_USER = os.environ.get('CAM_USER', 'admin')
CAM_PASS = os.environ.get('CAM_PASS', '')
CAM_PORT = int(os.environ.get('CAM_PORT', '554'))
LOOP = max(1, int(os.environ.get('LOOP', '1')))
FILES = [f for f in sys.argv[1:] if f]

BASE = 'rtsp://%s:%d/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif' % (CAM_IP, CAM_PORT)
SETUP_URI = BASE + '/trackID=5'
PT = 103            # PCMU/16000 (u-law 16kHz)
SAMPLES = 320       # 20ms @ 16000Hz
PACKET_INTERVAL = 0.02


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


class RtspTalk:
    """One backchannel session: DESCRIBE -> SETUP trackID=5 -> RECORD -> send RTP -> TEARDOWN."""

    def __init__(self, ip, port, user, pw):
        self.ip, self.port, self.user, self.pw = ip, port, user, pw
        self.sock = socket.create_connection((ip, port), timeout=8)
        self.sock.settimeout(15)
        self.cseq = 0
        self.auth = None       # (realm, nonce, qop)
        self.session = None

    def _request(self, method, uri, extra):
        self.cseq += 1
        lines = ['%s %s RTSP/1.0' % (method, uri), 'CSeq: %d' % self.cseq, 'User-Agent: cctv-audio']
        if self.auth:
            realm, nonce, qop = self.auth
            ha1 = md5('%s:%s:%s' % (self.user, realm, self.pw))
            ha2 = md5('%s:%s' % (method, uri))
            if qop:
                cn = os.urandom(8).hex()
                nc = '%08x' % self.cseq
                resp = md5('%s:%s:%s:%s:%s:%s' % (ha1, nonce, nc, cn, qop, ha2))
                lines.append('Authorization: Digest username="%s", realm="%s", nonce="%s", uri="%s", '
                             'qop=%s, nc=%s, cnonce="%s", response="%s"'
                             % (self.user, realm, nonce, uri, qop, nc, cn, resp))
            else:
                resp = md5('%s:%s:%s' % (ha1, nonce, ha2))
                lines.append('Authorization: Digest username="%s", realm="%s", nonce="%s", uri="%s", '
                             'response="%s"' % (self.user, realm, nonce, uri, resp))
        lines += extra + ['', '']
        self.sock.sendall('\r\n'.join(lines).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        return buf.decode('latin1')

    def _authed(self, method, uri, extra):
        r = self._request(method, uri, extra)
        if '401' in r.split('\r\n', 1)[0]:
            hdr = [l for l in r.split('\r\n') if l.lower().startswith('www-authenticate') and 'digest' in l.lower()]
            if not hdr:
                return r
            h = hdr[0]
            realm = re.search(r'realm="([^"]+)"', h).group(1)
            nonce = re.search(r'nonce="([^"]+)"', h).group(1)
            qm = re.search(r'qop="?([^",]+)"?', h)
            self.auth = (realm, nonce, qm.group(1) if qm else None)
            r = self._request(method, uri, extra)
        return r

    def open(self):
        bc = ['Accept: application/sdp', 'Require: www.onvif.org/ver20/backchannel']
        sdp = self._authed('DESCRIBE', BASE, bc)
        if 'sendonly' not in sdp:
            raise RuntimeError('no backchannel (camera has no ONVIF audio-out)')
        r = self._authed('SETUP', SETUP_URI, ['Transport: RTP/AVP/TCP;unicast;interleaved=0-1',
                                              'Require: www.onvif.org/ver20/backchannel'])
        if '200' not in r.split('\r\n', 1)[0]:
            raise RuntimeError('SETUP failed: %s' % r.split('\r\n', 1)[0])
        m = re.search(r'Session:\s*([^;\r\n]+)', r)
        self.session = m.group(1).strip() if m else None
        extra = (['Session: %s' % self.session] if self.session else []) + ['Require: www.onvif.org/ver20/backchannel']
        r = self._authed('RECORD', BASE, extra)
        if '200' not in r.split('\r\n', 1)[0]:
            raise RuntimeError('RECORD failed: %s' % r.split('\r\n', 1)[0])

    def play(self, audio):
        seqn = 0
        ts = 0
        ssrc = 0x43435456
        start = time.time()
        i = 0
        for off in range(0, len(audio) - SAMPLES, SAMPLES):
            rtp = struct.pack('!BBHII', 0x80, PT, seqn & 0xFFFF, ts, ssrc) + audio[off:off + SAMPLES]
            self.sock.sendall(b'$' + bytes([0]) + struct.pack('!H', len(rtp)) + rtp)
            seqn += 1
            ts += SAMPLES
            i += 1
            delay = start + i * PACKET_INTERVAL - time.time()
            if delay > 0:
                time.sleep(delay)
        return i

    def close(self):
        try:
            self._authed('TEARDOWN', BASE, ['Session: %s' % self.session] if self.session else [])
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass


def main():
    if not CAM_IP or not FILES:
        print('ERR: CAM_IP env and at least one .ulaw file required', file=sys.stderr)
        return 2
    total = 0
    announced = False
    for _ in range(LOOP):
        for path in FILES:
            try:
                audio = open(path, 'rb').read()
            except Exception as e:
                print('ERR read %s: %s' % (path, e), file=sys.stderr)
                return 3
            talk = None
            try:
                talk = RtspTalk(CAM_IP, CAM_PORT, CAM_USER, CAM_PASS)
                talk.open()
                if not announced:
                    # Backchannel is open -> the caller can return NOW (playback runs in the background).
                    print('PLAYING', flush=True)
                    announced = True
                sent = talk.play(audio)
                total += sent
                print('OK %s -> %.0fs (%d pkt)' % (os.path.basename(path), sent * PACKET_INTERVAL, sent))
            except Exception as e:
                print('ERR play %s: %s' % (os.path.basename(path), e), file=sys.stderr)
                return 4
            finally:
                if talk:
                    talk.close()
            time.sleep(0.4)  # small gap between clips
    print('DONE total %.0fs' % (total * PACKET_INTERVAL))
    return 0


if __name__ == '__main__':
    sys.exit(main())
