/*
Purpose: Live push-to-talk bridge — an admin's browser mic (u-law 16k frames over a WebSocket) is piped
         to a camera's ONVIF speaker in real time via scripts/audio_talk.py. The server does ZERO audio
         transcoding (the browser already produced exactly the RTP payload), so it stays light.
Caller: audioRoutes (mint ticket + the WS route), spawned python per active talk session.
Deps: child_process, connectionPool, audioCastService.parseRtsp, cameraAudioLock.
MainFuncs: mintTicket, talkHandler.
SideEffects: spawns python3 audio_talk.py (creds via ENV only); holds the shared camera audio lock.

Auth: a browser cannot set an Authorization header on a WS, so the client first POSTs (admin JWT + CSRF)
to mint a single-use, 30s ticket bound to {cameraId, adminUserId}. The WS presents the ticket; the server
also checks same-site Origin. Camera RTSP creds NEVER reach the browser — read here, passed to the child
via env. One talk per camera (shared lock); if a clip is playing the talk is refused (no garble).
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

const tickets = new Map(); // ticket -> { cameraId, adminUserId, expiresAt }

function sweepTickets() {
    const now = Date.now();
    for (const [t, v] of tickets) if (v.expiresAt < now) tickets.delete(t);
}

/** Mint a single-use talk ticket (called from an authed admin POST). */
export function mintTicket(cameraId, adminUserId) {
    sweepTickets();
    const id = parseInt(cameraId, 10);
    const cam = queryOne("SELECT id, name, private_rtsp_url, stream_source FROM cameras WHERE id = ? AND enabled = 1", [id]);
    if (!cam || cam.stream_source !== 'internal' || !cam.private_rtsp_url) {
        const e = new Error('Kamera tidak bisa menerima audio'); e.statusCode = 400; throw e;
    }
    const ticket = randomBytes(24).toString('base64url');
    tickets.set(ticket, { cameraId: id, adminUserId, expiresAt: Date.now() + TICKET_TTL_MS });
    return { ticket, wsPath: `/api/admin/audio/talk?ticket=${ticket}`, expiresInMs: TICKET_TTL_MS, cameraName: cam.name };
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
 * WebSocket handler (@fastify/websocket v11 passes the socket directly). Validates the ticket, spawns the
 * live pusher, and pipes binary frames to it until stop/close/timeout.
 */
export function talkHandler(socket, req) {
    const close = (code, msg) => { try { socket.close(code, msg); } catch { /* already closed */ } };

    if (!sameSiteOrigin(req)) { close(1008, 'origin'); return; }
    const ticket = (req.query && req.query.ticket) || '';
    const t = tickets.get(ticket);
    tickets.delete(ticket);                       // single-use
    if (!t || t.expiresAt < Date.now()) { close(1008, 'ticket'); return; }

    const cam = queryOne('SELECT id, name, private_rtsp_url FROM cameras WHERE id = ?', [t.cameraId]);
    const creds = cam && parseRtsp(cam.private_rtsp_url);
    if (!creds) { close(1011, 'camera'); return; }

    // One audio-out per camera. A clip currently playing is NOT preempted in this phase (no garble).
    if (holderKind(t.cameraId) || !acquire(t.cameraId, 'talk')) {
        try { socket.send(JSON.stringify({ type: 'error', message: 'Kamera sedang dipakai audio lain' })); } catch { /* */ }
        close(1013, 'busy');
        return;
    }

    const child = spawn(PY, [SCRIPT], {
        env: { ...process.env, CAM_IP: creds.ip, CAM_USER: creds.user, CAM_PASS: creds.pass, CAM_PORT: String(creds.port) },
    });
    let lastFrame = Date.now();
    let stopped = false;

    const stop = (reason) => {
        if (stopped) return;
        stopped = true;
        try { child.stdin.end(); } catch { /* */ }
        setTimeout(() => { try { child.kill('SIGTERM'); } catch { /* */ } }, 500); // let python TEARDOWN, then force
        release(t.cameraId);
        clearInterval(idleTimer);
        clearTimeout(hardCap);
        console.log(`[AudioTalk] Session end cam ${t.cameraId} (${reason}) by admin ${t.adminUserId}`);
        close(1000, reason);
    };

    child.stdout.on('data', (d) => {
        if (d.toString().includes('READY')) { try { socket.send(JSON.stringify({ type: 'ready', camera: cam.name })); } catch { /* */ } }
    });
    child.stderr.on('data', () => { /* python logs errors to stderr; keep quiet unless debugging */ });
    child.on('error', () => stop('spawn-error'));
    child.on('close', () => { if (!stopped) { try { socket.send(JSON.stringify({ type: 'ended' })); } catch { /* */ } stop('child-exit'); } });

    socket.on('message', (data, isBinary) => {
        if (isBinary) {
            if (data.length === 0 || data.length > MAX_FRAME_BYTES) return;
            lastFrame = Date.now();
            try { if (!stopped) child.stdin.write(data); } catch { /* child gone */ }
        } else {
            try { const m = JSON.parse(data.toString()); if (m.type === 'stop') stop('client-stop'); } catch { /* ignore non-JSON */ }
        }
    });
    socket.on('close', () => stop('ws-close'));
    socket.on('error', () => stop('ws-error'));

    const idleTimer = setInterval(() => { if (Date.now() - lastFrame > IDLE_MS) stop('idle'); }, 5000);
    const hardCap = setTimeout(() => stop('hard-cap'), HARD_CAP_MS);
    console.log(`[AudioTalk] Session start cam ${t.cameraId} by admin ${t.adminUserId}`);
}

export default { mintTicket, talkHandler };
