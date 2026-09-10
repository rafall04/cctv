/*
Purpose: HTTP handlers for "Titik Speaker" — network speaker nodes (STB + amp + TOA horn). Split out of
         audioController.js to keep that file under the size ratchet. Two audiences: ADMIN CRUD/broadcast
         (JWT-gated at the route) and the NODE agent (device TOKEN in a header, NOT an admin JWT).
Caller: backend/routes/audioRoutes.js (device + node routes).
Deps: audioDeviceService, audioClipService.getClipWav, securityAuditLogger.
MainFuncs: listDevices, createDevice, updateDevice, deleteDevice, regenDeviceToken, testDevice, playDevices,
           nodePoll, nodeClip.
SideEffects: writes device rows + command queue; serves clip audio to authenticated nodes.
*/

import {
    listDevices as deviceList, createDevice as deviceCreate, updateDevice as deviceUpdate,
    deleteDevice as deviceDelete, regenToken as deviceRegen, authDevice as deviceAuth,
    enqueueCommand as deviceEnqueue, touchDevice as deviceTouch, claimNextCommand as deviceClaim,
} from '../services/audioDeviceService.js';
import { getClipWav } from '../services/audioClipService.js';
import { addSink, removeSink } from '../services/audioDeviceTalk.js';
import { logAdminAction } from '../services/securityAuditLogger.js';

const TALK_STREAM_CAP_MS = 6 * 60 * 1000; // a talk stream can never stay open longer than this

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const POLL_HOLD_MS = 25000; // how long a node poll is held open (< Cloudflare's ~100s proxy timeout)
const POLL_STEP_MS = 300;   // how often the held poll checks the queue

// Tiny local copies (kept in step with audioController.js) so this module stands alone.
function parseId(value) {
    const id = parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}
function fail(reply, error, fallback = 'Internal server error') {
    const code = error.statusCode || 500;
    if (code === 500) console.error('Audio device error:', error);
    return reply.code(code).send({ success: false, message: code === 500 ? fallback : error.message });
}
function adminContext(request) {
    return { adminUserId: request.user?.id, adminUsername: request.user?.username };
}

/* -------------------------------------------- admin CRUD + broadcast (JWT-gated) */

export async function listDevices(request, reply) {
    try { return reply.send({ success: true, data: deviceList() }); }
    catch (error) { return fail(reply, error); }
}

export async function createDevice(request, reply) {
    try {
        const d = deviceCreate(request.body || {});
        logAdminAction({ action: 'audio_device_create', targetType: 'audio_device', targetId: d.id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Titik speaker dibuat', data: d }); // data carries the token ONCE
    } catch (error) { return fail(reply, error, 'Gagal membuat titik speaker'); }
}

export async function updateDevice(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tidak valid' });
        return reply.send({ success: true, data: deviceUpdate(id, request.body || {}) });
    } catch (error) { return fail(reply, error, 'Gagal memperbarui titik speaker'); }
}

export async function deleteDevice(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tidak valid' });
        const r = deviceDelete(id);
        logAdminAction({ action: 'audio_device_delete', targetType: 'audio_device', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Titik speaker dihapus', data: r });
    } catch (error) { return fail(reply, error); }
}

export async function regenDeviceToken(request, reply) {
    try {
        const id = parseId(request.params.id);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tidak valid' });
        const r = deviceRegen(id);
        logAdminAction({ action: 'audio_device_regen_token', targetType: 'audio_device', targetId: id, ...adminContext(request) }, request);
        return reply.send({ success: true, message: 'Token baru dibuat', data: r }); // token ONCE
    } catch (error) { return fail(reply, error); }
}

export async function testDevice(request, reply) {
    try {
        const id = parseId(request.params.id);
        const sid = parseId(request.body?.sourceId);
        if (!id) return reply.code(400).send({ success: false, message: 'ID tidak valid' });
        if (!sid) return reply.code(400).send({ success: false, message: 'Pilih audio uji dulu' });
        const n = deviceEnqueue([id], 'play', sid, 1);
        return reply.send({ success: true, message: n ? 'Uji dikirim — titik speaker memutarnya saat poll berikutnya' : 'Titik speaker nonaktif', data: { queued: n } });
    } catch (error) { return fail(reply, error, 'Gagal mengirim uji'); }
}

// Broadcast a clip to one or more Titik Speaker now (enqueue; nodes play it on their next poll).
export async function playDevices(request, reply) {
    try {
        const { deviceIds, sourceId, loop } = request.body || {};
        const sid = parseId(sourceId);
        if (!sid) return reply.code(400).send({ success: false, message: 'Pilih audio dulu' });
        const ids = Array.isArray(deviceIds) ? deviceIds : [];
        if (ids.length === 0) return reply.code(400).send({ success: false, message: 'Pilih titik speaker' });
        const n = deviceEnqueue(ids, 'play', sid, loop || 1);
        logAdminAction({ action: 'audio_device_play', targetType: 'audio_device', devices: n, sourceId: sid, ...adminContext(request) }, request);
        return reply.send({ success: true, message: n ? `Dikirim ke ${n} titik speaker` : 'Tak ada titik speaker aktif terpilih', data: { queued: n } });
    } catch (error) { return fail(reply, error, 'Gagal menyiarkan ke titik speaker'); }
}

/* ---- NODE endpoints: the STB agent (device TOKEN auth, NOT an admin JWT) ---- */
function deviceTokenFrom(request) {
    return request.headers['x-device-token'] || request.query?.token || '';
}

// The agent LONG-polls for its next command: the request is held open and returns the INSTANT a command is
// queued (trigger <1s — matters for adzan/emergency), or { command:null } after the hold window so the
// agent re-polls. A held GET (not an idle connection) survives Cloudflare; the await-loop doesn't block the
// event loop, so many nodes hold concurrently.
export async function nodePoll(request, reply) {
    try {
        const ip = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim() || request.ip;
        const dev = deviceAuth(deviceTokenFrom(request));
        if (!dev) return reply.code(401).send({ success: false, message: 'token tidak valid' });
        deviceTouch(dev.id, ip);
        const deadline = Date.now() + POLL_HOLD_MS;
        for (;;) {
            const cmd = deviceClaim(dev.id);
            if (cmd) {
                const out = { command: cmd.command, loop: cmd.loop };
                if (cmd.command === 'play' && cmd.clip_id) out.clip_url = `/api/admin/audio/node/clip/${cmd.clip_id}`;
                if (cmd.command === 'talk_start') out.stream_url = '/api/admin/audio/node/stream';
                return reply.send({ success: true, data: out });
            }
            if (Date.now() >= deadline || request.raw.destroyed) break; // window elapsed / client gone
            // eslint-disable-next-line no-await-in-loop
            await sleep(POLL_STEP_MS);
        }
        return reply.send({ success: true, data: { command: null } });
    } catch (error) { return fail(reply, error); }
}

// The agent downloads the clip to play (WAV, decoded from .ulaw). Token-gated like the poll.
export async function nodeClip(request, reply) {
    try {
        if (!deviceAuth(deviceTokenFrom(request))) return reply.code(401).send({ success: false, message: 'token tidak valid' });
        const id = parseId(request.params.id);
        let wav = null;
        try { wav = getClipWav(id); } catch { wav = null; }
        if (!wav || !wav.buffer) return reply.code(404).send({ success: false, message: 'Audio tidak ditemukan' });
        reply.header('Content-Type', 'audio/wav');
        reply.header('Cache-Control', 'no-store');
        return reply.send(wav.buffer);
    } catch (error) { return fail(reply, error); }
}

// Live push-to-talk SINK: the node opens this after a 'talk_start' command; the browser's mic frames
// (u-law 16k) are streamed to it as RAW bytes, played by `aplay -f MU_LAW`. Held open until talk ends
// (sink.end -> EOF), the node disconnects, or a hard cap. Token-gated; half-duplex (node only receives).
export async function nodeStream(request, reply) {
    const dev = deviceAuth(deviceTokenFrom(request));
    if (!dev) return reply.code(401).send({ success: false, message: 'token tidak valid' });
    reply.hijack(); // we own reply.raw now — do NOT use reply.send
    const res = reply.raw;
    try {
        res.writeHead(200, { 'Content-Type': 'audio/basic', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    } catch { return undefined; }
    let closed = false;
    const sink = {
        write: (buf) => { if (!closed) res.write(buf); },
        end: () => { if (!closed) { closed = true; try { res.end(); } catch { /* gone */ } } },
    };
    addSink(dev.id, sink);
    let cap = null;
    const cleanup = () => { closed = true; removeSink(dev.id, sink); if (cap) clearTimeout(cap); try { res.end(); } catch { /* gone */ } };
    cap = setTimeout(cleanup, TALK_STREAM_CAP_MS);
    res.on('close', cleanup);
    res.on('error', cleanup);
    return undefined;
}
