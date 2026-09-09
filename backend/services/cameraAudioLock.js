/*
Purpose: One shared "audio-out per camera" lock across ALL paths that push RTP to a camera speaker —
         clip/playlist/scheduled playback (audioCastService) AND live push-to-talk (audioTalkService).
         Two streams to one backchannel garble each other, so exactly one may hold a camera at a time.
         Also the box-wide GOVERNOR: caps how many cameras sound at once (weak box + ~20 recording ffmpeg).
Caller: audioCastService, audioTalkService, audioCapabilityService (isBusy skip).
MainFuncs: acquire, preempt, release, isBusy, holderKind, busyReason, activeAudioCount.
SideEffects: in-memory Map — valid only on a single (primary) worker; if the backend ever runs multiple
             cluster instances this must move to a DB lock (UNIQUE(camera_id)). Prod is fork/1-instance.

TWO fixes that make preemption SAFE (the old preempt only swapped the Map, leaving the displaced child
alive → garble + a wedged process pinning the camera):
  1. Every holder registers a `stop` callback; preempt() actually CALLS it to kill the displaced child.
  2. Each hold carries a monotonic `token`; release(id, token) is a no-op if a newer holder took over,
     so the displaced child's late exit can't delete the emergency holder that replaced it.
*/

const held = new Map(); // cameraId -> { kind: 'clip'|'talk', since, stop, token }
let seq = 0;
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.AUDIO_MAX_CONCURRENT || '4', 10));

/**
 * Try to take the lock, subject to the box-wide governor. Returns a truthy token on success, or null when
 * the camera is already held OR the concurrency cap is reached. `stop` kills this holder's child if a
 * later higher-priority broadcast preempts it.
 */
export function acquire(cameraId, kind, stop = null) {
    const id = parseInt(cameraId, 10);
    if (held.has(id)) return null;
    if (held.size >= MAX_CONCURRENT) return null; // governor: don't fan out further right now
    const token = ++seq;
    held.set(id, { kind, since: Date.now(), stop, token });
    return token;
}

/**
 * Force the lock for a higher-priority broadcast (emergency clip / talk preempting a clip). KILLS the
 * displaced holder's child, then installs the new holder with a fresh token. Bypasses the governor cap
 * (net-zero on count when it displaces). Returns { displaced, token }.
 */
export function preempt(cameraId, kind, stop = null) {
    const id = parseInt(cameraId, 10);
    const prev = held.get(id) || null;
    if (prev && typeof prev.stop === 'function') { try { prev.stop(); } catch { /* already gone */ } }
    const token = ++seq;
    held.set(id, { kind, since: Date.now(), stop, token });
    return { displaced: prev ? prev.kind : null, token };
}

/** Release the lock. If `token` is given, only release when THIS holder is still current (preempt-safe). */
export function release(cameraId, token = null) {
    const id = parseInt(cameraId, 10);
    const cur = held.get(id);
    if (!cur) return;
    if (token !== null && cur.token !== token) return; // a newer holder took over — leave it alone
    held.delete(id);
}

export function isBusy(cameraId) {
    return held.has(parseInt(cameraId, 10));
}

export function holderKind(cameraId) {
    const h = held.get(parseInt(cameraId, 10));
    return h ? h.kind : null;
}

/** How many cameras are sounding right now (governor gauge). */
export function activeAudioCount() {
    return held.size;
}

export function governorFull() {
    return held.size >= MAX_CONCURRENT;
}

/** Human message for a failed acquire — distinguishes "camera busy" from "governor full". */
export function busyReason(cameraId) {
    if (held.has(parseInt(cameraId, 10))) return 'kamera sedang dipakai audio lain';
    if (held.size >= MAX_CONCURRENT) return `batas ${MAX_CONCURRENT} siaran serempak tercapai`;
    return 'sibuk';
}

export const MAX_AUDIO_CONCURRENT = MAX_CONCURRENT;
export default { acquire, preempt, release, isBusy, holderKind, activeAudioCount, governorFull, busyReason, MAX_AUDIO_CONCURRENT };
