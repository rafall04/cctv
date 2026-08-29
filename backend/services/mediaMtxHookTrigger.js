// Purpose: Coalesced trigger for MediaMTX push hooks (Phase 3). Debounces a flapping path's repeated
//          ready/notready events per camera and caps concurrent re-checks, so a MediaMTX-restart burst
//          (every always_on path re-connecting at once) cannot swamp the check function / MediaMTX API.
// Caller: cameraHealthService (onMediaMtxPathEvent delegates here); unit-tested directly.
// Deps: none — pure scheduling over an injected `check(cameraId)` callback and an injectable clock.
//
// This owns NO verdict: it only decides WHETHER/WHEN to call `check`. The check itself (the real
// weighted evaluation) is the source of truth, so dropping an event here is always safe — the poll
// loop still re-checks the camera on its cadence. See internalHookController for the full safety model.

const DEFAULT_DEBOUNCE_MS = 3 * 1000;
const DEFAULT_MAX_INFLIGHT = 20;

export class MediaMtxHookTrigger {
    constructor({ check, debounceMs = DEFAULT_DEBOUNCE_MS, maxInflight = DEFAULT_MAX_INFLIGHT, now = () => Date.now() } = {}) {
        this.check = check;
        this.debounceMs = debounceMs;
        this.maxInflight = maxInflight;
        this.now = now;
        this.inFlight = 0;
        this.lastEventAt = new Map();
    }

    onEvent(cameraId, event) {
        if (!cameraId || typeof this.check !== 'function') {
            return;
        }
        if (process.env.HEALTH_HOOK_DEBUG === 'true') {
            console.log(`[CameraHealth] push hook received: camera ${cameraId} ${event}`);
        }
        const now = this.now();
        const last = this.lastEventAt.get(cameraId);
        // A camera's FIRST event must never be debounced (no prior timestamp). Only suppress a repeat
        // that lands within the window — guarding on `undefined` rather than a `|| 0` default, which
        // would wrongly debounce the first event under any small clock value.
        if (last !== undefined && now - last < this.debounceMs) {
            return; // coalesce a flapping path's rapid ready/notready storm
        }

        if (this.inFlight >= this.maxInflight) {
            // Burst shedding (e.g. MediaMTX restart). Nothing is lost: the poll loop still re-checks
            // this camera on its cadence. Do NOT stamp lastEventAt here — a merely-shed event must not
            // poison the debounce window, or this camera's next genuine event would be wrongly
            // suppressed even after capacity frees up.
            return;
        }
        // Stamp only on ACTUAL dispatch, so the debounce window reflects real re-checks, not sheds.
        this.lastEventAt.set(cameraId, now);
        this.inFlight += 1;
        Promise.resolve()
            .then(() => this.check(cameraId))
            .catch((error) => console.error(`[CameraHealth] push-hook re-check for camera ${cameraId} failed:`, error?.message))
            .finally(() => { this.inFlight -= 1; });
    }
}

export default MediaMtxHookTrigger;
