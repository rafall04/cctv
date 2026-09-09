/*
Purpose: One shared "audio-out per camera" lock across ALL paths that push RTP to a camera speaker —
         clip/playlist/scheduled playback (audioCastService) AND live push-to-talk (audioTalkService).
         Two streams to one backchannel garble each other, so exactly one may hold a camera at a time.
Caller: audioCastService, audioTalkService, audioCapabilityService (isBusy skip).
MainFuncs: acquire, release, isBusy, holderKind.
SideEffects: in-memory Map — valid only on a single (primary) worker; if the backend ever runs multiple
             cluster instances this must move to a DB lock (UNIQUE(camera_id)). Prod is fork/1-instance.

Priority: live talk PREEMPTS clip playback (a person talking beats a recorded announcement); clip never
preempts talk. Callers implement preemption via holderKind() + the talk path forcing acquisition.
*/

const held = new Map(); // cameraId -> { kind: 'clip' | 'talk', since: number }

/** Try to take the lock. Returns true if acquired, false if already held. */
export function acquire(cameraId, kind) {
    const id = parseInt(cameraId, 10);
    if (held.has(id)) return false;
    held.set(id, { kind, since: Date.now() });
    return true;
}

/** Force the lock for a higher-priority holder (talk preempting a clip). Returns the displaced kind, if any. */
export function preempt(cameraId, kind) {
    const id = parseInt(cameraId, 10);
    const prev = held.get(id) || null;
    held.set(id, { kind, since: Date.now() });
    return prev ? prev.kind : null;
}

export function release(cameraId) {
    held.delete(parseInt(cameraId, 10));
}

export function isBusy(cameraId) {
    return held.has(parseInt(cameraId, 10));
}

export function holderKind(cameraId) {
    const h = held.get(parseInt(cameraId, 10));
    return h ? h.kind : null;
}

export default { acquire, preempt, release, isBusy, holderKind };
