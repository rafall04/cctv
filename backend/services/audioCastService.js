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

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'scripts', 'audio_cast.py');
const PY = process.env.AUDIO_CAST_PYTHON || 'python3';
const PLAY_TIMEOUT_MS = 15 * 60 * 1000; // hard cap so a wedged session can never pin a camera

// Cameras currently streaming audio — one broadcast per camera at a time (overlapping RTP = garble).
const busy = new Set();

/** True while a camera is mid-broadcast — the capability prober skips it (a second backchannel = garble). */
export function isBusy(id) {
    return busy.has(parseInt(id, 10));
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

function runPusher(cam, files, loop) {
    return new Promise((resolve) => {
        const child = spawn(PY, [SCRIPT, ...files], {
            env: {
                ...process.env,
                CAM_IP: cam.ip, CAM_USER: cam.user, CAM_PASS: cam.pass,
                CAM_PORT: String(cam.port), LOOP: String(loop),
            },
        });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), PLAY_TIMEOUT_MS);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, message: `spawn gagal: ${e.message}` }); });
        child.on('close', (code) => {
            clearTimeout(timer);
            const ok = code === 0;
            const msg = ok ? (out.trim().split('\n').pop() || 'OK')
                : (err.trim().split('\n').pop() || `keluar kode ${code}`);
            resolve({ ok, message: msg });
        });
    });
}

/**
 * Play a source (clip|playlist) to one or more cameras concurrently.
 * @returns {Promise<{results: Array, files: number}>}
 */
export async function playToCameras(cameraIds, sourceType, sourceId, loop = 1) {
    const { files } = resolveSourceFiles(sourceType, sourceId);
    if (files.length === 0) {
        const err = new Error('Tidak ada audio untuk diputar (clip/playlist kosong atau berkas hilang)');
        err.statusCode = 400; throw err;
    }
    const ids = [...new Set((cameraIds || []).map((x) => parseInt(x, 10)).filter(Number.isInteger))];
    if (ids.length === 0) { const err = new Error('Pilih minimal satu kamera'); err.statusCode = 400; throw err; }
    const loopN = Math.min(Math.max(parseInt(loop, 10) || 1, 1), 20);

    const results = await Promise.all(ids.map(async (id) => {
        const row = queryOne('SELECT id, name, private_rtsp_url FROM cameras WHERE id = ?', [id]);
        if (!row) return { cameraId: id, name: `#${id}`, ok: false, message: 'kamera tidak ada' };
        const cam = parseRtsp(row.private_rtsp_url);
        if (!cam) return { cameraId: id, name: row.name, ok: false, message: 'kamera tanpa RTSP internal' };
        if (busy.has(id)) return { cameraId: id, name: row.name, ok: false, message: 'kamera sedang memutar audio' };
        busy.add(id);
        try {
            const r = await runPusher(cam, files, loopN);
            return { cameraId: id, name: row.name, ...r };
        } finally {
            busy.delete(id);
        }
    }));
    return { results, files: files.length };
}

/** One-camera speaker test: plays whatever source is given (used with a short built-in test clip). */
export async function testCamera(cameraId, sourceType, sourceId) {
    const { results } = await playToCameras([cameraId], sourceType, sourceId, 1);
    return results[0];
}

export default { listTargetCameras, resolveSourceFiles, playToCameras, testCamera };
