/*
Purpose: Play an audio clip or playlist to camera speakers via the ONVIF backchannel, by spawning
         backend/scripts/audio_cast.py (proven RTSP backchannel pusher). The orchestration layer for
         the Audio Broadcast feature: resolve camera creds + source files, run the pusher, guard overlap.
Caller: audioController (play-now / test), audioScheduleService (scheduled plays).
Deps: child_process, connectionPool (camera creds + playlist items), audioClipService (clip paths).
MainFuncs: playToCameras, testCamera, resolveSourceFiles, listTargetCameras.
SideEffects: spawns python3 (short-lived, one per camera per play); reads RTSP creds server-side only.

Creds NEVER leave the server: the camera's rtsp URL (with password) is read from the DB here and passed
to the child ONLY via env vars, never argv (so it stays out of `ps`) and never toward the frontend.
*/

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne } from '../database/connectionPool.js';
import { clipPath, getClip } from './audioClipService.js';
import { acquire, preempt, release, busyReason } from './cameraAudioLock.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'scripts', 'audio_cast.py');
const PY = process.env.AUDIO_CAST_PYTHON || 'python3';
const PLAY_TIMEOUT_MS = 15 * 60 * 1000; // hard cap so a wedged session can never pin a camera

// Re-exported for audioCapabilityService (skip a camera that is mid-broadcast). One audio-out per camera
// is enforced by cameraAudioLock, shared with live push-to-talk — a second RTP stream would garble.
export { isBusy } from './cameraAudioLock.js';

// Clip/playlist playbacks currently running in the BACKGROUND (fire-and-forget), so the operator can stop
// one they started by mistake. cameraId -> { child, name, source, startedAt }.
const playing = new Map();

/** Cameras currently playing a clip/playlist, with elapsed seconds — for the "Sedang diputar" list. */
export function listPlaying() {
    const now = Date.now();
    return [...playing.entries()].map(([cameraId, p]) => ({
        cameraId, name: p.name, source: p.source, seconds: Math.round((now - p.startedAt) / 1000),
    }));
}

/** Stop a running playback on one camera (SIGTERM lets python TEARDOWN the backchannel cleanly). */
export function stopPlaying(cameraId) {
    const p = playing.get(parseInt(cameraId, 10));
    if (!p) return false;
    try { p.child.kill('SIGTERM'); } catch { /* already gone */ }
    setTimeout(() => { try { p.child.kill('SIGKILL'); } catch { /* gone */ } }, 1500); // backstop
    return true;
}

/** Stop every running playback. Returns how many were stopped. */
export function stopAllPlaying() {
    const ids = [...playing.keys()];
    ids.forEach((id) => stopPlaying(id));
    return ids.length;
}

export function parseRtsp(url) {
    const m = /^rtsp:\/\/([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/i.exec(url || '');
    if (!m) return null;
    return {
        user: decodeURIComponent(m[1]),
        pass: decodeURIComponent(m[2]),
        ip: m[3],
        port: m[4] ? parseInt(m[4], 10) : 554,
    };
}

/** Internal cameras that could have a speaker (external HLS feeds never do). */
export function listTargetCameras() {
    return query(`
        SELECT c.id, c.name, a.name AS area_name
        FROM cameras c LEFT JOIN areas a ON a.id = c.area_id
        WHERE c.enabled = 1 AND c.stream_source = 'internal'
          AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != ''
          AND c.audio_out_blocked = 0
        ORDER BY c.name ASC
    `);
}

/** Ordered list of on-disk .ulaw paths for a clip or a playlist. Skips clips whose file is gone. */
export function resolveSourceFiles(sourceType, sourceId) {
    let clips = [];
    if (sourceType === 'clip') {
        const c = getClip(sourceId);
        if (c) clips = [c];
    } else if (sourceType === 'playlist') {
        clips = query(`
            SELECT c.* FROM audio_playlist_items i
            JOIN audio_clips c ON c.id = i.clip_id
            WHERE i.playlist_id = ? ORDER BY i.sort_order ASC, i.id ASC
        `, [parseInt(sourceId, 10)]);
    }
    const files = [];
    let duration = 0;
    for (const c of clips) {
        const p = clipPath(c.base_filename);
        if (p) { files.push(p); duration += c.duration_sec || 0; }
    }
    return { files, duration, clipCount: clips.length };
}

/**
 * Spawn the pusher and resolve AS SOON AS the backchannel is open ('PLAYING'), not when playback ends —
 * a 6-minute song must not hold the HTTP request open (the client times out at 30s). Playback continues
 * in the background; `onDone` fires when the child actually exits (so the caller releases the camera lock
 * only then). A camera without a backchannel fails fast (open() raises) → {ok:false} well within 30s.
 */
function runPusher(cam, files, loop, ctx) {
    return new Promise((resolve) => {
        let settled = false;
        let out = '';
        let err = '';
        let release = ctx.onDone;
        const done = () => {
            playing.delete(ctx.id);
            if (release) { const f = release; release = null; f(); }
        };
        const settle = (r) => { if (!settled) { settled = true; resolve(r); } };
        const child = spawn(PY, [SCRIPT, ...files], {
            env: {
                ...process.env,
                CAM_IP: cam.ip, CAM_USER: cam.user, CAM_PASS: cam.pass,
                CAM_PORT: String(cam.port), LOOP: String(loop),
                GAIN_DB: String(ctx.gainDb || 0), // runtime loudness (dB), applied via ffmpeg volume+limiter
            },
        });
        // Track it so the operator can stop a playback they started by mistake.
        playing.set(ctx.id, { child, name: ctx.name, source: ctx.source, startedAt: Date.now() });
        const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, PLAY_TIMEOUT_MS);
        child.stdout.on('data', (d) => {
            out += d.toString();
            if (out.includes('PLAYING')) settle({ ok: true, message: 'diputar' }); // started; keep running
        });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', (e) => { clearTimeout(timer); settle({ ok: false, message: `spawn gagal: ${e.message}` }); done(); });
        child.on('close', (code) => {
            clearTimeout(timer);
            // A SIGTERM stop reports as a clean stop, not an error.
            settle({ ok: code === 0 || code === null, message: code === 0 || code === null ? 'diputar' : (err.trim().split('\n').pop() || `keluar kode ${code}`) });
            done(); // playback finished/stopped -> release the camera lock now
        });
    });
}

/**
 * Play a source (clip|playlist) to one or more cameras concurrently.
 * @returns {Promise<{results: Array, files: number}>}
 */
export async function playToCameras(cameraIds, sourceType, sourceId, loop = 1, opts = {}) {
    const preemptMode = opts.preempt === true; // emergency: displace whatever is playing + bypass the governor cap
    const gainDb = Math.max(-24, Math.min(24, Number(opts.gainDb) || 0)); // runtime loudness (dB)
    const { files } = resolveSourceFiles(sourceType, sourceId);
    if (files.length === 0) {
        const err = new Error('Tidak ada audio untuk diputar (clip/playlist kosong atau berkas hilang)');
        err.statusCode = 400; throw err;
    }
    const ids = [...new Set((cameraIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) { const err = new Error('Pilih minimal satu kamera'); err.statusCode = 400; throw err; }
    const loopN = Math.min(Math.max(parseInt(loop, 10) || 1, 1), 20);

    const results = await Promise.all(ids.map(async (id) => {
        const row = queryOne(
            'SELECT c.id, c.name, c.private_rtsp_url, c.audio_out_blocked, a.max_loop FROM cameras c LEFT JOIN areas a ON a.id = c.area_id WHERE c.id = ?',
            [id],
        );
        if (!row) return { cameraId: id, name: `#${id}`, ok: false, message: 'kamera tidak ada' };
        // Hard safety stop: a blocked camera (V380-class) is never opened — a backchannel can hang it.
        if (row.audio_out_blocked) return { cameraId: id, name: row.name, ok: false, message: 'diblokir (perangkat rawan hang)' };
        const cam = parseRtsp(row.private_rtsp_url);
        if (!cam) return { cameraId: id, name: row.name, ok: false, message: 'kamera tanpa RTSP internal' };
        // The stop callback lets a later higher-priority broadcast preempt THIS play (kill its child cleanly).
        const stopThis = () => stopPlaying(id);
        let token;
        if (preemptMode) {
            token = preempt(id, 'clip', stopThis).token; // emergency: take the camera now
        } else {
            token = acquire(id, 'clip', stopThis);
            if (!token) return { cameraId: id, name: row.name, ok: false, message: busyReason(id) };
        }
        // Per-area loop ceiling (plafon) caps repeats on this camera's area; falls back to the requested loop.
        const camLoop = row.max_loop ? Math.min(loopN, row.max_loop) : loopN;
        // Lock is released by runPusher's onDone when the child ACTUALLY exits — token-guarded so a play that
        // was preempted mid-flight can't release the emergency holder that replaced it.
        const r = await runPusher(cam, files, camLoop, { id, name: row.name, source: sourceType, gainDb, onDone: () => release(id, token) });
        return { cameraId: id, name: row.name, ...r };
    }));
    return { results, files: files.length };
}

/** One-camera speaker test: plays whatever source is given (used with a short built-in test clip). */
export async function testCamera(cameraId, sourceType, sourceId) {
    const { results } = await playToCameras([cameraId], sourceType, sourceId, 1);
    return results[0];
}

export default { listTargetCameras, resolveSourceFiles, playToCameras, testCamera };
