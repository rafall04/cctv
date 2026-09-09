#!/usr/bin/env python3
"""
Purpose: SILENT capability probe for the ONVIF audio-out backchannel — DESCRIBE only, NEVER SETUP/RECORD,
         so it makes NO sound and opens no backchannel session. Classifies one camera as supported /
         unsupported / unknown for the Audio Broadcast feature (see audioCapabilityService.js).
Caller:  backend audioCapabilityService (spawned per camera; creds via ENV, same shape as audio_cast.py).
Input:   env CAM_IP, CAM_USER, CAM_PASS, optional CAM_PORT (default 554).
Output:  ONE JSON line to stdout: {"verdict","note","detail"}; exit code 0=supported, 10=unsupported,
         20=unknown/unreachable. Never prints credentials or the RTSP URL.

WHY the predicate is trackID=5 + PCMU/16000: the live pusher (audio_cast.py) hard-codes SETUP trackID=5
and streams PCMU/16000 (PT 103). So "supported" MUST mean "that pusher will make sound" — verified against
real prod SDP 2026-09-09: IMOU PS3E (AHASS/Ngitik) offer sendonly audio at trackID=5 with PCMU/16000;
IMOU S41FE returns 200 with NO audio track; and several other cameras offer sendonly audio at trackID
1/2/3 with PCMA/8000 (NOT drivable by the current pusher — recorded in the note as a future candidate for
a generalized pusher that reads a=control from the SDP).
"""
import os
import re
import sys
import json
import socket
import hashlib

CAM_IP = os.environ.get('CAM_IP', '')
CAM_USER = os.environ.get('CAM_USER', 'admin')
CAM_PASS = os.environ.get('CAM_PASS', '')
CAM_PORT = int(os.environ.get('CAM_PORT', '554'))
TIMEOUT = float(os.environ.get('PROBE_TIMEOUT', '5'))

BASE = 'rtsp://%s:%d/cam/realmonitor?channel=1&subtype=0&unicast=true&proto=Onvif' % (CAM_IP, CAM_PORT)


def md5(s):
    return hashlib.md5(s.encode()).hexdigest()


def emit(verdict, note, detail, code):
    print(json.dumps({'verdict': verdict, 'note': note, 'detail': detail}))
    sys.exit(code)


def describe():
    """Returns (status_line, sdp_body). Raises on transport failure."""
    s = socket.create_connection((CAM_IP, CAM_PORT), timeout=TIMEOUT)
    s.settimeout(TIMEOUT)
    cseq = [0]
    auth = [None]

    def request(method, uri, extra):
        cseq[0] += 1
        lines = ['%s %s RTSP/1.0' % (method, uri), 'CSeq: %d' % cseq[0], 'User-Agent: cctv-probe']
        if auth[0]:
            realm, nonce, qop = auth[0]
            ha1 = md5('%s:%s:%s' % (CAM_USER, realm, CAM_PASS))
            ha2 = md5('%s:%s' % (method, uri))
            if qop:
                cn = os.urandom(8).hex()
                nc = '%08x' % cseq[0]
                resp = md5('%s:%s:%s:%s:%s:%s' % (ha1, nonce, nc, cn, qop, ha2))
                lines.append('Authorization: Digest username="%s", realm="%s", nonce="%s", uri="%s", '
                             'qop=%s, nc=%s, cnonce="%s", response="%s"'
                             % (CAM_USER, realm, nonce, uri, qop, nc, cn, resp))
            else:
                resp = md5('%s:%s:%s' % (ha1, nonce, ha2))
                lines.append('Authorization: Digest username="%s", realm="%s", nonce="%s", uri="%s", '
                             'response="%s"' % (CAM_USER, realm, nonce, uri, resp))
        lines += extra + ['', '']
        s.sendall('\r\n'.join(lines).encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            ch = s.recv(4096)
            if not ch:
                break
            buf += ch
        head = buf.split(b'\r\n\r\n', 1)[0].decode('latin1')
        body = buf.split(b'\r\n\r\n', 1)[1] if b'\r\n\r\n' in buf else b''
        cl = re.search(r'Content-Length:\s*(\d+)', head, re.I)
        if cl:
            need = int(cl.group(1))
            while len(body) < need:
                ch = s.recv(4096)
                if not ch:
                    break
                body += ch
        return head, body.decode('latin1')

    bc = ['Accept: application/sdp', 'Require: www.onvif.org/ver20/backchannel']
    head, body = request('DESCRIBE', BASE, bc)
    status = head.split('\r\n', 1)[0]
    if '401' in status:
        h = [l for l in head.split('\r\n') if l.lower().startswith('www-authenticate') and 'digest' in l.lower()]
        if h:
            realm = re.search(r'realm="([^"]+)"', h[0])
            nonce = re.search(r'nonce="([^"]+)"', h[0])
            qm = re.search(r'qop="?([^",]+)"?', h[0])
            if realm and nonce:
                auth[0] = (realm.group(1), nonce.group(1), qm.group(1) if qm else None)
                head, body = request('DESCRIBE', BASE, bc)
                status = head.split('\r\n', 1)[0]
    # NO SETUP / NO RECORD reached -> nothing is streamed, speaker stays silent.
    try:
        s.close()
    except Exception:
        pass
    return status, body


def analyze_sdp(sdp):
    """Per-media-section scan: find sendonly audio track(s), their control trackID and codecs.
    Returns (supported, note, detail)."""
    # Split into media sections; the header (before first m=) is dropped.
    parts = re.split(r'(?=^m=)', sdp, flags=re.M)
    sendonly_audio = []  # list of (trackId, codecs[])
    for sec in parts:
        if not sec.startswith('m=audio'):
            continue
        if 'a=sendonly' not in sec:
            continue
        tid = re.search(r'trackID=(\d+)', sec)
        codecs = re.findall(r'a=rtpmap:\d+\s+([A-Za-z0-9/]+)', sec)
        sendonly_audio.append((tid.group(1) if tid else None, codecs))

    if not sendonly_audio:
        return (False, 'no sendonly audio track', 'DESCRIBE 200 without a backchannel media')

    # The current pusher SETUPs trackID=5 + streams PCMU/16000. Supported iff such a track is offered.
    def has_pcmu16(codecs):
        return any(re.match(r'PCMU/16000', c, re.I) for c in codecs)

    for tid, codecs in sendonly_audio:
        if tid == '5' and has_pcmu16(codecs):
            return (True, 'backchannel trackID=5 PCMU/16000', 'codecs=' + ';'.join(codecs))
    # A sendonly track exists but not the one the pusher drives -> unsupported now, candidate later.
    tid0, codecs0 = sendonly_audio[0]
    return (False, 'sendonly trackID=%s (pusher needs trackID=5+PCMU/16000)' % (tid0 or '?'),
            'candidate; codecs=' + ';'.join(codecs0))


def main():
    if not CAM_IP:
        emit('unknown', 'no CAM_IP', '', 20)
    try:
        status, sdp = describe()
    except Exception as e:
        emit('unknown', 'unreachable: %s' % type(e).__name__, '', 20)
    if '401' in status:
        emit('unknown', 'auth-failed', '', 20)      # bad/rotated creds -> cannot conclude
    if '200' not in status:
        code = re.search(r'RTSP/1.0 (\d+)', status)
        emit('unsupported', 'describe %s' % (code.group(1) if code else '?'), '', 10)
    supported, note, detail = analyze_sdp(sdp)
    emit('supported' if supported else 'unsupported', note, detail, 0 if supported else 10)


if __name__ == '__main__':
    main()
