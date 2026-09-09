/*
Purpose: Live push-to-talk / ZONE PAGING — an admin's browser mic (u-law 16k frames over a WebSocket) is
         fanned out to ONE OR MORE camera ONVIF speakers in real time via scripts/audio_talk.py (one child
         per camera). The server does ZERO transcoding (the browser already produced the RTP payload).
Caller: audioRoutes (mint ticket + the WS route), spawned python per active talk camera.
Deps: child_process, connectionPool, audioCastService.parseRtsp, cameraAudioLock.
MainFuncs: mintTicket, talkHandler.
SideEffects: spawns python3 audio_talk.py per camera (creds via ENV only); holds the shared camera lock.

Auth: a browser cannot set an Authorization header on a WS, so the client first POSTs (admin JWT + CSRF)
to mint a single-use, 30s ticket bound to {cameraIds, adminUserId}. The WS presents the ticket; the server
also checks same-site Origin. Camera RTSP creds NEVER reach the browser.

Zone paging caveat: cheap-camera backchannel endurance under simultaneous RECORD is unproven, so the
fan-out is capped hard (AUDIO_MAX_TALK, default 4), only SUPPORTED + non-blocked cameras are eligible, and
a busy camera is skipped (never preempted by talk). One audio-out per camera (shared lock).
*/

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { queryOne } from '../database/connectionPool.js';
import { parseRtsp } from './audioCastService.js';
import { acquire, release, holderKind } from './cameraAudioLock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'scripts', 'audio_talk.py');
const PY = process.env.AUDIO_CAST_PYTHON || 'python3';
const TICKET_TTL_MS = 30 * 1000;
const IDLE_MS = 15 * 1000;             // no audio frame for this long -> auto-stop
const HARD_CAP_MS = 5 * 60 * 1000;     // a session can never pin a camera longer than this
const MAX_FRAME_BYTES = 4096;          // a 20ms u-law frame is 320B; anything huge is bogus -> drop
const MAX_TALK_CAMERAS = Math.max(1, parseInt(process.env.AUDIO_MAX_TALK || '4', 10));

const tickets = new Map(); // ticket -> { cameraIds:[], adminUserId, expiresAt }

function sweepTickets() {
    const now = Date.now();
    for (const [t, v] of tickets) if (v.expiresAt < now) tickets.delete(t);
}

/**
 * Mint a single-use talk ticket for one OR MORE cameras (zone paging). Filters to eligible cameras
 * (internal + has RTSP + NOT blocked) and caps the fan-out. Throws 400 if none are eligible.
 */
export function mintTicket(cameraIds, adminUserId) {
    sweepTickets();
    const raw = Array.isArray(cameraIds) ? cameraIds : [cameraIds];
    const ids = [...new Set(raw.map((x) => parseInt(x, 10)).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_TALK_CAMERAS);
    const eligible = [];
    for (const id of ids) {
        const cam = queryOne('SELECT id, name, private_rtsp_url, stream_source, audio_out_blocked FROM cameras WHERE id = ? AND enabled = 1', [id]);
        if (cam && cam.stream_source === 'internal' && cam.private_rtsp_url && !cam.audio_out_blocked) eligible.push(cam.id);
    }
    if (eligible.length === 0) { const e = new Error('Tak ada kamera yang bisa menerima audio'); e.statusCode = 400; throw e; }
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { cameraIds: eligible, adminUserId, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, wsPath: `/api/admin/audio/talk?ticket=${ticket}`, expiresInMs: TICKET_TTL_MS, cameraCount: eligible.length };
}

function sameSiteOrigin(req) {
    // WS bypasses CORS, so verify Origin/Sec-Fetch-Site explicitly (defence against a cross-site WS).
    const site = req.headers['sec-fetch-site'];
    if (site && site !== 'same-origin' && site !== 'same-site') return false;
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (origin && host) {
        try { if (new URL(origin).host !== host) return false; } catch { return false; }
    }
    return true;
}

/**
 * WebSocket handler (@fastify/websocket v11 passes the socket directly). Validates the ticket, spawns a
 * pusher per eligible+free camera, and fans out binary frames to all of them until stop/close/timeout.
 */
export function talkHandler(socket, req) {
    const close = (code, msg) => { try { socket.close(code, msg); } catch { /* already closed */ } };

    if (!sameSiteOrigin(req)) { close(1008, 'origin'); return; }
    const ticket = (req.query && req.query.ticket) || '';
    const t = tickets.get(ticket);
    tickets.delete(ticket);                       // single-use
    if (!t || t.expiresAt < Date.now()) { close(1008, 'ticket'); return; }

    // Acquire + spawn a child per camera that is free (talk never preempts; a busy camera is skipped).
    const sessions = []; // { id, name, child, token }
    for (const id of t.cameraIds) {
        const cam = queryOne('SELECT id, name, private_rtsp_url FROM cameras WHERE id = ?', [id]);
        const creds = cam && parseRtsp(cam.private_rtsp_url);
        if (!creds) continue;
        if (holderKind(id)) continue;             // already sounding (clip/talk) -> skip
        const token = acquire(id, 'talk', () => killSession(id, 'preempted'));
        if (!token) continue;                     // governor full / raced -> skip
        const child = spawn(PY, [SCRIPT], {
            env: { ...process.env, CAM_IP: creds.ip, CAM_USER: creds.user, CAM_PASS: creds.pass, CAM_PORT: String(creds.port) },
        });
        const s = { id, name: cam.name, child, token };
        child.stdout.on('data', (d) => { if (d.toString().includes('READY')) s.ready = true; });
        child.stderr.on('data', () => { /* python logs to stderr; quiet unless debugging */ });
        child.on('error', () => killSession(id, 'spawn-error'));
        child.on('close', () => killSession(id, 'child-exit'));
        sessions.push(s);
    }

    if (sessions.length === 0) {
        try { socket.send(JSON.stringify({ type: 'error', message: 'Semua kamera tujuan sedang dipakai audio lain' })); } catch { /* */ }
        close(1013, 'busy');
        return;
    }

    let lastFrame = Date.now();
    let stopped = false;

    function killSession(id, reason) {
        const i = sessions.findIndex((x) => x.id === id);
        if (i === -1) return;
        const s = sessions[i];
        sessions.splice(i, 1);
        try { s.child.stdin.end(); } catch { /* */ }
        setTimeout(() => { try { s.child.kill('SIGTERM'); } catch { /* */ } }, 500);
        release(id, s.token);
        if (sessions.length === 0 && !stopped) stopAll(`all-ended:${reason}`);
    }

    function stopAll(reason) {
        if (stopped) return;
        stopped = true;
        clearInterval(idleTimer);
        clearTimeout(hardCap);
        for (const s of sessions.slice()) {
            try { s.child.stdin.end(); } catch { /* */ }
            setTimeout(() => { try { s.child.kill('SIGTERM'); } catch { /* */ } }, 500);
            release(s.id, s.token);
        }
        sessions.length = 0;
        console.log(`[AudioTalk] Session end (${reason}) by admin ${t.adminUserId}`);
        try { socket.send(JSON.stringify({ type: 'ended' })); } catch { /* */ }
        close(1000, reason);
    }

    socket.on('message', (data, isBinary) => {
        if (isBinary) {
            if (data.length === 0 || data.length > MAX_FRAME_BYTES) return;
            lastFrame = Date.now();
            for (const s of sessions) { try { s.child.stdin.write(data); } catch { /* child gone */ } }
        } else {
            try { const m = JSON.parse(data.toString()); if (m.type === 'stop') stopAll('client-stop'); } catch { /* ignore non-JSON */ }
        }
    });
    socket.on('close', () => stopAll('ws-close'));
    socket.on('error', () => stopAll('ws-error'));

    const idleTimer = setInterval(() => { if (Date.now() - lastFrame > IDLE_MS) stopAll('idle'); }, 5000);
    const hardCap = setTimeout(() => stopAll('hard-cap'), HARD_CAP_MS);
    try { socket.send(JSON.stringify({ type: 'ready', cameras: sessions.map((s) => s.name), count: sessions.length })); } catch { /* */ }
    console.log(`[AudioTalk] Session start ${sessions.length} camera(s) by admin ${t.adminUserId}`);
}

export default { mintTicket, talkHandler };
