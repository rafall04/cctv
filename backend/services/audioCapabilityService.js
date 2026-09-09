/*
Purpose: Detect + persist which cameras support the ONVIF audio-out backchannel, by spawning the SILENT
         DESCRIBE probe (scripts/audio_probe.py) and writing a tri-state to the cameras table. Powers the
         Audio Broadcast target picker so an operator sees which cameras will actually make sound.
Caller: audioController (recheck endpoints, list), audioBroadcastBootstrap (periodic sweep), audioTargetService (reads columns).
Deps: child_process, connectionPool, audioCastService.parseRtsp.
MainFuncs: probeCamera, recheckAll, listCapabilities, markStale, startCapabilitySweep.
SideEffects: spawns python3 (short-lived, DESCRIBE-only = NO sound); writes cameras.supports_audio_out/*.

Tri-state honesty (see the migration): only a CONCLUSIVE probe writes supports_audio_out (1 supported /
0 unsupported) + audio_out_checked_at. An UNKNOWN result (unreachable / auth-fail) writes NOTHING — the
camera stays due for re-probe and keeps its last known value; a modem blip must never mark a real speaker
"unsupported" (the EHOSTUNREACH-weight lesson). The sweep only touches cameras in an audio-enabled area,
so the ~394 Surabaya cameras are never probed until an admin opts their area in.
*/

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { parseRtsp, isBusy } from './audioCastService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBE = join(__dirname, '..', 'scripts', 'audio_probe.py');
const PY = process.env.AUDIO_CAST_PYTHON || 'python3';
const PROBE_TIMEOUT_MS = 12000;
const TTL_MS = 7 * 24 * 3600 * 1000;         // capability is near-static -> re-probe weekly
const SWEEP_INTERVAL_MS = 6 * 3600 * 1000;   // gentle background net
const SWEEP_MAX_PER_RUN = 20;                 // oldest-due-first slice (weak box)
const GAP_MS = 400;                           // small pause between probes

const nowIso = () => new Date().toISOString();
const clip = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : null);

/** Spawn the silent probe for one camera. Returns {verdict:'supported'|'unsupported'|'unknown', note}. */
function runProbe(cam) {
    return new Promise((resolve) => {
        const child = spawn(PY, [PROBE], {
            env: { ...process.env, CAM_IP: cam.ip, CAM_USER: cam.user, CAM_PASS: cam.pass, CAM_PORT: String(cam.port) },
        });
        let out = '';
        let err = '';
        const timer = setTimeout(() => child.kill('SIGKILL'), PROBE_TIMEOUT_MS);
        child.stdout.on('data', (d) => { out += d.toString(); });
        child.stderr.on('data', (d) => { err += d.toString(); });
        child.on('error', () => { clearTimeout(timer); resolve({ verdict: 'unknown', note: 'spawn-failed' }); });
        child.on('close', () => {
            clearTimeout(timer);
            const line = out.trim().split('\n').filter(Boolean).pop() || '';
            try {
                const j = JSON.parse(line);
                resolve({ verdict: j.verdict || 'unknown', note: clip(j.note) || null });
            } catch {
                resolve({ verdict: 'unknown', note: clip(err.trim().split('\n').pop()) || 'no-output' });
            }
        });
    });
}

function persist(cameraId, verdict, note) {
    // Only conclusive verdicts touch the tri-state + freshness. UNKNOWN leaves prior state untouched.
    if (verdict === 'supported' || verdict === 'unsupported') {
        execute('UPDATE cameras SET supports_audio_out = ?, audio_out_checked_at = ?, audio_out_note = ? WHERE id = ?',
            [verdict === 'supported' ? 1 : 0, nowIso(), note, cameraId]);
    }
}

/** Probe ONE camera by id (used by the on-demand "recheck" button). Persists a conclusive result. */
export async function probeCamera(cameraId) {
    const row = queryOne('SELECT id, name, private_rtsp_url, stream_source FROM cameras WHERE id = ?', [parseInt(cameraId, 10)]);
    if (!row) { const e = new Error('Kamera tidak ditemukan'); e.statusCode = 404; throw e; }
    if (row.stream_source !== 'internal') return { cameraId: row.id, name: row.name, verdict: 'unknown', note: 'bukan kamera internal' };
    if (isBusy(row.id)) return { cameraId: row.id, name: row.name, verdict: 'unknown', note: 'kamera sedang broadcast' };
    const cam = parseRtsp(row.private_rtsp_url);
    if (!cam) return { cameraId: row.id, name: row.name, verdict: 'unknown', note: 'tanpa RTSP internal' };
    const r = await runProbe(cam);
    persist(row.id, r.verdict, r.note);
    return { cameraId: row.id, name: row.name, verdict: r.verdict, note: r.note };
}

/** Cameras that are due for a probe, scoped to audio-enabled areas only (never the Surabaya fleet). */
function dueCameras(limit) {
    const staleBefore = new Date(Date.now() - TTL_MS).toISOString();
    return query(`
        SELECT c.id, c.name, c.private_rtsp_url
        FROM cameras c JOIN areas a ON a.id = c.area_id
        WHERE c.enabled = 1 AND c.stream_source = 'internal'
          AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != ''
          AND a.audio_broadcast_enabled = 1
          AND (c.supports_audio_out IS NULL OR c.audio_out_checked_at IS NULL OR c.audio_out_checked_at < ?)
        ORDER BY c.audio_out_checked_at IS NOT NULL, c.audio_out_checked_at ASC
        LIMIT ?`, [staleBefore, limit]);
}

/**
 * Probe a batch (sweep or "recheck all"). Sequential with a small gap — the local fleet is tiny (~dozens),
 * and sequential keeps the weak box calm next to ~20 recording ffmpeg. Logs ONE count line, not per-item.
 * @param {{force?: boolean}} opts force=true re-probes all in-scope cameras regardless of TTL.
 */
export async function recheckAll({ force = false } = {}) {
    const rows = force
        ? query(`SELECT c.id, c.name, c.private_rtsp_url FROM cameras c JOIN areas a ON a.id = c.area_id
                 WHERE c.enabled = 1 AND c.stream_source = 'internal' AND c.private_rtsp_url IS NOT NULL
                   AND c.private_rtsp_url != '' AND a.audio_broadcast_enabled = 1 ORDER BY c.name LIMIT 200`)
        : dueCameras(SWEEP_MAX_PER_RUN);
    const tally = { supported: 0, unsupported: 0, unknown: 0 };
    for (const row of rows) {
        if (isBusy(row.id)) continue; // skip a camera mid-broadcast; catch it next run
        const cam = parseRtsp(row.private_rtsp_url);
        if (!cam) { tally.unknown += 1; continue; }
        const r = await runProbe(cam);          // eslint-disable-line no-await-in-loop
        persist(row.id, r.verdict, r.note);
        tally[r.verdict] = (tally[r.verdict] || 0) + 1;
        await new Promise((res) => setTimeout(res, GAP_MS)); // eslint-disable-line no-await-in-loop
    }
    if (rows.length > 0) {
        console.log(`[AudioCap] Probed ${rows.length}: ${tally.supported} supported, ${tally.unsupported} unsupported, ${tally.unknown} unknown`);
    }
    return { probed: rows.length, ...tally };
}

/** Capability rows for the admin UI (scoped to audio-enabled areas). */
export function listCapabilities() {
    return query(`
        SELECT c.id, c.name, a.name AS area_name, c.area_id,
               c.supports_audio_out, c.audio_out_checked_at, c.audio_out_note
        FROM cameras c JOIN areas a ON a.id = c.area_id
        WHERE c.enabled = 1 AND c.stream_source = 'internal'
          AND c.private_rtsp_url IS NOT NULL AND c.private_rtsp_url != ''
          AND a.audio_broadcast_enabled = 1
        ORDER BY c.supports_audio_out DESC NULLS LAST, c.name ASC`);
}

/** Mark a camera for re-probe (call when its IP/RTSP/creds change). Non-blocking; sweep/button re-probes. */
export function markStale(cameraId) {
    execute('UPDATE cameras SET audio_out_checked_at = NULL WHERE id = ?', [parseInt(cameraId, 10)]);
}

export function startCapabilitySweep() {
    const t = setInterval(() => {
        recheckAll({ force: false }).catch((e) => console.error('[AudioCap] Sweep error:', e.message));
    }, SWEEP_INTERVAL_MS);
    if (t.unref) t.unref();
    console.log('[AudioCap] Capability sweep started (6h, audio-enabled areas only)');
    return t;
}

export default { probeCamera, recheckAll, listCapabilities, markStale, startCapabilitySweep };
