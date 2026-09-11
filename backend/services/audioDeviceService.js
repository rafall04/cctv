/*
Purpose: "Titik Speaker" nodes — network speakers (STB/Armbian + amp + TOA horn) that receive broadcasts
         over the LAN for spots without a camera speaker. Each node authenticates with its own device TOKEN
         and PULLS commands (short-poll) from a tiny per-device queue, so it works behind NAT and tolerates
         being offline. This service owns device CRUD, token auth, the command queue, and liveness.
Caller: audioController (admin CRUD + node poll), audioDeviceCastService (enqueue on broadcast).
Deps: connectionPool, crypto.
MainFuncs: listDevices, createDevice, updateDevice, deleteDevice, regenToken, authDevice, enqueueCommand, pollDevice.
SideEffects: writes audio_devices + audio_device_commands (parameterized).
*/

import { query, queryOne, execute } from '../database/connectionPool.js';
import { randomBytes } from 'crypto';

// last_seen within this = "online". MUST exceed the node long-poll hold (POLL_HOLD_MS=25s): last_seen is
// stamped when a poll STARTS, so a node quietly holding a 25s long-poll would otherwise flip to "offline"
// mid-hold and blink in the UI. 40s = one full hold + margin.
const ONLINE_WINDOW_MS = 40000;
// Queued commands older than this are dropped on the next poll: a device offline for a long time must NOT
// replay a stale announcement (e.g. an adzan queued an hour ago) when it reconnects. Generous but bounded.
export const COMMAND_TTL_MS = Math.max(30, parseInt(process.env.AUDIO_DEVICE_CMD_TTL_SEC || '600', 10)) * 1000;

// Per-device authorization grants for clip downloads. When a poll hands a node a clip_url, we record that
// (device -> clip) pairing here; nodeClip then refuses any clip the device was not actually told to fetch,
// so one low-trust device token (an STB in a public spot) can't enumerate the whole clip library by id
// (IDOR/BOLA). In-memory + single-process like the talk sink registry; a grant expires with the command TTL
// (a node downloads its clip right after the poll that named it).
const clipGrants = new Map(); // deviceId -> Map<clipId, expiresAtMs>

/** Authorize a device to download a specific clip (called when a poll emits that clip's URL). */
export function grantClip(deviceId, clipId) {
    const did = parseInt(deviceId, 10);
    const cid = parseInt(clipId, 10);
    if (!Number.isInteger(did) || !Number.isInteger(cid)) return;
    if (!clipGrants.has(did)) clipGrants.set(did, new Map());
    clipGrants.get(did).set(cid, Date.now() + COMMAND_TTL_MS);
}

/** True if the device was told (recently) to fetch this clip. Prunes the grant when it has expired. */
export function isClipGranted(deviceId, clipId) {
    const did = parseInt(deviceId, 10);
    const cid = parseInt(clipId, 10);
    const m = clipGrants.get(did);
    if (!m) return false;
    const exp = m.get(cid);
    if (!exp) return false;
    if (Date.now() >= exp) { m.delete(cid); if (m.size === 0) clipGrants.delete(did); return false; }
    return true;
}

function isOnline(lastSeen) {
    if (!lastSeen) return false;
    const t = Date.parse(`${String(lastSeen).replace(' ', 'T')}Z`); // stored as UTC "YYYY-MM-DD HH:MM:SS"
    return Number.isFinite(t) && (Date.now() - t) < ONLINE_WINDOW_MS;
}

// Public shape — NEVER leak the raw token in list/detail views (returned only once at create/regen).
function decorate(row) {
    if (!row) return row;
    const { token, ...rest } = row;
    return { ...rest, online: isOnline(row.last_seen), has_token: Boolean(token) };
}

export function listDevices() {
    return query(`SELECT d.*, a.name AS area_name FROM audio_devices d
                  LEFT JOIN areas a ON a.id = d.area_id ORDER BY d.name COLLATE NOCASE`).map(decorate);
}

export function createDevice({ name, areaId = null } = {}) {
    const clean = String(name || '').trim().slice(0, 80);
    if (!clean) { const e = new Error('Nama titik speaker wajib diisi'); e.statusCode = 400; throw e; }
    const token = randomBytes(24).toString('base64url');
    const info = execute('INSERT INTO audio_devices (name, area_id, token) VALUES (?, ?, ?)',
        [clean, areaId ? parseInt(areaId, 10) : null, token]);
    const row = queryOne('SELECT * FROM audio_devices WHERE id = ?', [info.lastInsertRowid]);
    return { ...decorate(row), token }; // token shown ONCE
}

export function updateDevice(id, { name, areaId, enabled } = {}) {
    const did = parseInt(id, 10);
    const row = queryOne('SELECT * FROM audio_devices WHERE id = ?', [did]);
    if (!row) { const e = new Error('Titik speaker tidak ditemukan'); e.statusCode = 404; throw e; }
    const nextName = name !== undefined ? (String(name).trim().slice(0, 80) || row.name) : row.name;
    const nextArea = areaId !== undefined ? (areaId ? parseInt(areaId, 10) : null) : row.area_id;
    const nextEnabled = enabled !== undefined ? (enabled ? 1 : 0) : row.enabled;
    execute('UPDATE audio_devices SET name = ?, area_id = ?, enabled = ? WHERE id = ?', [nextName, nextArea, nextEnabled, did]);
    return decorate(queryOne('SELECT * FROM audio_devices WHERE id = ?', [did]));
}

export function regenToken(id) {
    const did = parseInt(id, 10);
    const row = queryOne('SELECT id FROM audio_devices WHERE id = ?', [did]);
    if (!row) { const e = new Error('Titik speaker tidak ditemukan'); e.statusCode = 404; throw e; }
    const token = randomBytes(24).toString('base64url');
    execute('UPDATE audio_devices SET token = ? WHERE id = ?', [token, did]);
    return { id: did, token };
}

export function deleteDevice(id) {
    const did = parseInt(id, 10);
    const row = queryOne('SELECT id, name FROM audio_devices WHERE id = ?', [did]);
    if (!row) { const e = new Error('Titik speaker tidak ditemukan'); e.statusCode = 404; throw e; }
    execute('DELETE FROM audio_device_commands WHERE device_id = ?', [did]);
    execute('DELETE FROM audio_devices WHERE id = ?', [did]);
    return { id: did, name: row.name };
}

/** Resolve a node by its token (device auth). Returns the row or null. Disabled devices do not authenticate. */
export function authDevice(token) {
    const t = String(token || '').trim();
    if (!t) return null;
    return queryOne('SELECT * FROM audio_devices WHERE token = ? AND enabled = 1', [t]) || null;
}

/**
 * Enqueue a command to one or more ENABLED devices. 'play' needs clip_id; 'stop' clears the device's queue.
 * @returns {number} how many devices the command was enqueued to.
 */
const ALLOWED_COMMANDS = ['play', 'stop', 'talk_start', 'talk_end'];
export function enqueueCommand(deviceIds, command, clipId = null, loop = 1) {
    const ids = [...new Set((deviceIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return 0;
    const cmd = ALLOWED_COMMANDS.includes(command) ? command : 'play';
    const cid = cmd === 'play' ? (parseInt(clipId, 10) || null) : null;
    if (cmd === 'play' && !cid) { const e = new Error('clip_id wajib untuk play'); e.statusCode = 400; throw e; }
    const n = Math.min(Math.max(parseInt(loop, 10) || 1, 1), 20);
    let count = 0;
    for (const id of ids) {
        const dev = queryOne('SELECT id FROM audio_devices WHERE id = ? AND enabled = 1', [id]);
        if (!dev) continue;
        // 'stop'/'talk_start' supersede anything pending (drop stale queue first) so a live action is immediate.
        if (cmd === 'stop' || cmd === 'talk_start') execute('DELETE FROM audio_device_commands WHERE device_id = ?', [id]);
        execute('INSERT INTO audio_device_commands (device_id, command, clip_id, loop) VALUES (?, ?, ?, ?)', [id, cmd, cid, n]);
        count += 1;
    }
    return count;
}

/** Mark a device as seen now (+ its source IP). Cheap; called every poll so liveness stays fresh. */
export function touchDevice(deviceId, ip = null) {
    execute("UPDATE audio_devices SET last_seen = datetime('now'), last_ip = COALESCE(?, last_ip) WHERE id = ?",
        [ip ? String(ip).slice(0, 64) : null, parseInt(deviceId, 10)]);
}

/** Claim (delete + return) the oldest queued command for a device, or null. Used by the long-poll loop. */
export function claimNextCommand(deviceId) {
    const did = parseInt(deviceId, 10);
    // Fast path: an empty queue — the common case on the 300ms hot poll loop, for every held poll — must do
    // ZERO writes. The old code fired an unconditional stale-DELETE every tick, hammering SQLite's single
    // writer and contending with unrelated billing/recording writes even when nothing was queued.
    let cmd = queryOne('SELECT * FROM audio_device_commands WHERE device_id = ? ORDER BY id ASC LIMIT 1', [did]);
    if (!cmd) return null;
    // Something is queued: drop any stale backlog first (a long-offline node must not replay old audio),
    // then re-pick the oldest fresh command.
    execute("DELETE FROM audio_device_commands WHERE device_id = ? AND created_at < datetime('now', ?)",
        [did, `-${Math.round(COMMAND_TTL_MS / 1000)} seconds`]);
    cmd = queryOne('SELECT * FROM audio_device_commands WHERE device_id = ? ORDER BY id ASC LIMIT 1', [did]);
    if (!cmd) return null;
    execute('DELETE FROM audio_device_commands WHERE id = ?', [cmd.id]);
    return cmd;
}

/**
 * Titik Speaker "belongs to an area": a device joins any broadcast that reaches its area. These resolve the
 * ENABLED devices for a broadcast target, gated by the area's audio_broadcast_enabled (the SAME gate cameras
 * use in playToCameras) — so a device in an audio-disabled area stays silent, and an unassigned (area_id
 * NULL) device never auto-joins (reachable only via the explicit Titik Speaker broadcast).
 */
export function enabledDeviceIdsInAreas(areaIds) {
    const ids = [...new Set((areaIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return [];
    return query(`SELECT d.id FROM audio_devices d JOIN areas a ON a.id = d.area_id
                  WHERE d.enabled = 1 AND a.audio_broadcast_enabled = 1 AND d.area_id IN (${ids.map(() => '?').join(',')})`, ids)
        .map((r) => r.id);
}

/** Enabled devices that share an area with any of the given cameras (for camera-list broadcast targets). */
export function enabledDeviceIdsForCameras(cameraIds) {
    const ids = [...new Set((cameraIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return [];
    return query(`SELECT DISTINCT d.id FROM audio_devices d JOIN areas a ON a.id = d.area_id
                  WHERE d.enabled = 1 AND a.audio_broadcast_enabled = 1
                    AND d.area_id IN (SELECT area_id FROM cameras WHERE id IN (${ids.map(() => '?').join(',')}) AND area_id IS NOT NULL)`, ids)
        .map((r) => r.id);
}

/** Cast a clip OR playlist to a set of devices. A playlist expands to its items in order (the node's queue
 *  is FIFO, so it plays them in sequence). `preempt` (adzan/emergency) clears the node queue first so the
 *  announcement takes over cleanly; otherwise it appends. Returns how many ENABLED devices were enqueued. */
export function castToDevices(deviceIds, sourceType, sourceId, loop = 1, { preempt = false } = {}) {
    const ids = [...new Set((deviceIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) return 0;
    let clipIds;
    if (sourceType === 'playlist') {
        clipIds = query('SELECT clip_id FROM audio_playlist_items WHERE playlist_id = ? ORDER BY sort_order ASC, id ASC', [parseInt(sourceId, 10)]).map((r) => r.clip_id);
    } else {
        const cid = parseInt(sourceId, 10);
        clipIds = cid ? [cid] : [];
    }
    if (clipIds.length === 0) return 0;
    if (preempt) enqueueCommand(ids, 'stop'); // take over: clear the node's queue before the new sequence
    let count = 0;
    clipIds.forEach((cid, i) => { const c = enqueueCommand(ids, 'play', cid, loop); if (i === 0) count = c; });
    return count; // enabled devices that received the (first) clip
}

/** Stop clip playback on every enabled device (kill-switch companion to stopAllPlaying). */
export function stopAllDevices() {
    const ids = query('SELECT id FROM audio_devices WHERE enabled = 1').map((r) => r.id);
    return enqueueCommand(ids, 'stop');
}

/** One-shot poll: authenticate, mark seen, and claim the oldest command. Returns {device, command}. */
export function pollDevice(token, ip = null) {
    const dev = authDevice(token);
    if (!dev) return { device: null, command: null };
    touchDevice(dev.id, ip);
    return { device: dev, command: claimNextCommand(dev.id) };
}

export default {
    listDevices, createDevice, updateDevice, deleteDevice, regenToken,
    authDevice, enqueueCommand, touchDevice, claimNextCommand, pollDevice,
    enabledDeviceIdsInAreas, enabledDeviceIdsForCameras, castToDevices, stopAllDevices,
    grantClip, isClipGranted,
};
