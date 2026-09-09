/*
Purpose: Motion -> deterrent-audio manager. For each ARMED camera (inside its arm window), it runs an ONVIF
         PullPoint subscriber (scripts/onvif_motion.py) and, on a motion signal, plays a deterrent clip on
         that camera's speaker — but ONLY through heavy guards: per-camera cooldown, hourly cap, supported +
         non-blocked, and the arm window. This is the highest-risk feature (auto-fire to a fragile camera),
         so it is OFF by default and every guard is conservative.
Caller: audioController (arm CRUD), audioBroadcastBootstrap (startMotionManager, primary worker only).
Deps: child_process, connectionPool, audioCastService.parseRtsp/playToCameras, audioClipService.getClip,
      audioTargetService.listBroadcastTargets, audioHistoryService.logPlay.
MainFuncs: listArms, setArm, disarm, reconcile, startMotionManager.
SideEffects: spawns onvif_motion.py per armed camera; on a guarded motion event, plays a deterrent clip.
*/

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { query, queryOne, execute } from '../database/connectionPool.js';
import { parseRtsp, playToCameras } from './audioCastService.js';
import { getClip } from './audioClipService.js';
import { listBroadcastTargets } from './audioTargetService.js';
import { logPlay } from './audioHistoryService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, '..', 'scripts', 'onvif_motion.py');
const PY = process.env.AUDIO_CAST_PYTHON || 'python3';
const RECONCILE_MS = 30000;

const subscribers = new Map(); // cameraId -> child process

const nowIso = () => new Date().toISOString();
const hourKey = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 13); // WIB hour

function armActive(a) {
    if (!a.enabled) return false;
    if (a.arm_until && new Date(a.arm_until).getTime() <= Date.now()) return false;
    return true;
}

/** Arms with camera name + capability + whether currently active (for the UI). */
export function listArms() {
    const rows = query(`
        SELECT m.*, c.name AS camera_name, a.name AS area_name, c.supports_audio_out, c.audio_out_blocked
        FROM audio_motion_arms m JOIN cameras c ON c.id = m.camera_id LEFT JOIN areas a ON a.id = c.area_id
        ORDER BY c.name`);
    return rows.map((r) => ({ ...r, active: armActive(r) }));
}

const clampInt = (v, def, lo, hi) => {
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? Math.min(Math.max(n, lo), hi) : def;
};

/** Create/update a camera's motion arm. `armMinutes` sets arm_until (0/undefined = indefinite while enabled). */
export function setArm(cameraId, fields = {}) {
    const id = parseInt(cameraId, 10);
    const cam = queryOne("SELECT id FROM cameras WHERE id = ? AND stream_source = 'internal'", [id]);
    if (!cam) { const e = new Error('Kamera internal tidak ditemukan'); e.statusCode = 404; throw e; }
    const existing = queryOne('SELECT * FROM audio_motion_arms WHERE camera_id = ?', [id]);
    const enabled = fields.enabled !== undefined ? (fields.enabled ? 1 : 0) : (existing ? existing.enabled : 0);
    const clipId = fields.clip_id !== undefined ? (parseInt(fields.clip_id, 10) || null) : (existing ? existing.clip_id : null);
    const cooldown = fields.cooldown_sec !== undefined ? clampInt(fields.cooldown_sec, 60, 10, 3600) : (existing ? existing.cooldown_sec : 60);
    const maxHour = fields.max_per_hour !== undefined ? clampInt(fields.max_per_hour, 6, 1, 60) : (existing ? existing.max_per_hour : 6);
    const port = fields.onvif_port !== undefined ? clampInt(fields.onvif_port, 80, 1, 65535) : (existing ? existing.onvif_port : 80);
    let armUntil = existing ? existing.arm_until : null;
    if (fields.arm_minutes !== undefined) {
        const mins = clampInt(fields.arm_minutes, 0, 0, 1440);
        armUntil = mins > 0 ? new Date(Date.now() + mins * 60000).toISOString() : null;
    }
    if (existing) {
        execute('UPDATE audio_motion_arms SET enabled=?, clip_id=?, cooldown_sec=?, max_per_hour=?, onvif_port=?, arm_until=? WHERE camera_id=?',
            [enabled, clipId, cooldown, maxHour, port, armUntil, id]);
    } else {
        execute('INSERT INTO audio_motion_arms (camera_id, enabled, clip_id, cooldown_sec, max_per_hour, onvif_port, arm_until) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, enabled, clipId, cooldown, maxHour, port, armUntil]);
    }
    reconcile();
    return queryOne('SELECT * FROM audio_motion_arms WHERE camera_id = ?', [id]);
}

export function disarm(cameraId) {
    const id = parseInt(cameraId, 10);
    execute('UPDATE audio_motion_arms SET enabled = 0, arm_until = NULL WHERE camera_id = ?', [id]);
    reconcile();
    return { camera_id: id, enabled: 0 };
}

// Guarded deterrent fire on a motion signal.
async function maybeFire(cameraId) {
    const a = queryOne('SELECT * FROM audio_motion_arms WHERE camera_id = ?', [cameraId]);
    if (!a || !armActive(a) || !a.clip_id) return;
    // supported + not blocked (never touch a hang-prone or unsupported camera)
    const target = listBroadcastTargets({ includeUnknown: false }).find((t) => t.id === cameraId);
    if (!target) return;
    const now = Date.now();
    if (a.last_fired && now - new Date(a.last_fired).getTime() < a.cooldown_sec * 1000) return; // cooldown
    const hk = hourKey();
    const firedInHour = a.hour_key === hk ? a.fired_in_hour : 0;
    if (firedInHour >= a.max_per_hour) return; // hourly cap
    execute('UPDATE audio_motion_arms SET last_fired = ?, hour_key = ?, fired_in_hour = ? WHERE camera_id = ?',
        [nowIso(), hk, firedInHour + 1, cameraId]);
    try {
        const { results } = await playToCameras([cameraId], 'clip', a.clip_id, 1); // normal mode (respects lock/governor)
        logPlay({ sourceType: 'clip', sourceId: a.clip_id, sourceName: `MOTION: ${getClip(a.clip_id)?.name || ''}`.trim(), cameraIds: [cameraId], results, operatorName: 'motion-auto' });
        console.log(`[Motion] Deter fired on camera ${cameraId} (${results.filter((r) => r.ok).length}/1)`);
    } catch (e) {
        console.error(`[Motion] Deter play error cam ${cameraId}:`, e.message);
    }
}

function startSubscriber(cameraId) {
    const cam = queryOne('SELECT id, private_rtsp_url FROM cameras WHERE id = ?', [cameraId]);
    const creds = cam && parseRtsp(cam.private_rtsp_url);
    if (!creds) return;
    const arm = queryOne('SELECT onvif_port FROM audio_motion_arms WHERE camera_id = ?', [cameraId]);
    const child = spawn(PY, [SCRIPT], {
        env: { ...process.env, CAM_IP: creds.ip, CAM_USER: creds.user, CAM_PASS: creds.pass, ONVIF_PORT: String(arm?.onvif_port || 80) },
    });
    subscribers.set(cameraId, child);
    let buf = '';
    child.stdout.on('data', (d) => {
        buf += d.toString();
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.event === 'signal' && /^(true|1)$/i.test(String(msg.value))) {
                    maybeFire(cameraId).catch(() => {});
                }
            } catch { /* non-JSON */ }
        }
    });
    child.on('error', () => { subscribers.delete(cameraId); });
    child.on('close', () => { subscribers.delete(cameraId); });
}

/** Sync running subscribers to the set of active arms (supported cameras only). Idempotent. */
export function reconcile() {
    let arms;
    try { arms = query('SELECT * FROM audio_motion_arms'); } catch { return; } // table may not exist pre-migrate
    const supported = new Set(listBroadcastTargets({ includeUnknown: false }).map((t) => t.id));
    const shouldRun = new Set(arms.filter((a) => armActive(a) && a.clip_id && supported.has(a.camera_id)).map((a) => a.camera_id));
    for (const [id, child] of subscribers) {
        if (!shouldRun.has(id)) { try { child.kill('SIGTERM'); } catch { /* gone */ } subscribers.delete(id); }
    }
    for (const id of shouldRun) if (!subscribers.has(id)) startSubscriber(id);
}

export function startMotionManager() {
    const t = setInterval(() => { try { reconcile(); } catch (e) { console.error('[Motion] reconcile error:', e.message); } }, RECONCILE_MS);
    if (t.unref) t.unref();
    setTimeout(() => { try { reconcile(); } catch { /* */ } }, 8000); // initial, after boot settles
    console.log('[Motion] Motion->deter manager started (reconcile 30s, primary worker)');
    return t;
}

export default { listArms, setArm, disarm, reconcile, startMotionManager };
