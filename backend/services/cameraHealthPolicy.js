/*
Purpose: Resolve external camera health monitoring modes from camera, area, and global defaults,
         and enforce the sweep's settlement policy: no single probe may hang the fleet.
Caller: CameraHealthService and direct policy tests.
Deps: cameraDelivery utility.
MainFuncs: normalizeExternalHealthMode(), resolveExternalHealthMode(), guardProbeSettlement().
SideEffects: None beyond one timer per guarded probe, cleared on settlement.
*/

import {
    getEffectiveDeliveryType,
    normalizeExternalHealthMode as normalizeCameraExternalHealthMode,
} from '../utils/cameraDelivery.js';

export const normalizeExternalHealthMode = normalizeCameraExternalHealthMode;

export function resolveExternalHealthMode(camera, defaults = {}) {
    const explicitMode = normalizeExternalHealthMode(camera?.external_health_mode);
    if (explicitMode !== 'default') {
        return explicitMode;
    }

    const areaOverrideMode = normalizeExternalHealthMode(camera?.area_external_health_mode_override);
    if (areaOverrideMode !== 'default') {
        return areaOverrideMode;
    }

    const deliveryType = getEffectiveDeliveryType(camera);

    if (deliveryType === 'external_mjpeg') {
        return defaults.external_mjpeg || 'passive_first';
    }

    if (deliveryType === 'external_hls') {
        return defaults.external_hls || 'hybrid_probe';
    }

    if (deliveryType === 'external_flv') {
        return defaults.external_flv || 'passive_first';
    }

    if (deliveryType === 'external_embed') {
        return defaults.external_embed || 'passive_first';
    }

    if (deliveryType === 'external_jsmpeg' || deliveryType === 'external_custom_ws') {
        return defaults[deliveryType] || 'disabled';
    }

    return 'hybrid_probe';
}

/*
 * Every probe generation reaches the sweep through Promise.allSettled, and allSettled
 * waits for SETTLEMENT — a promise that never settles holds it open forever. That is not
 * hypothetical: a camera that accepted a probe's TCP connection and FIN'd without replying
 * left rtspProbe's promise resolver-less, and the health sweep never completed again for
 * the life of the process (447 completions on 2026-08-17, zero afterwards, silently —
 * the self-rescheduling timeout chain dies in a .finally() that never runs). Every camera
 * that happened to be offline at that instant stayed "offline" for two days while its
 * stream played fine in MediaMTX.
 *
 * The root cause was fixed where it lived (rtspProbe now listens for 'close'), but the
 * sweep must not stake the whole fleet on every current and future probe being perfectly
 * settlement-clean. This rejects a probe that outlives its deadline; the sweep already
 * logs and skips rejected probes per camera, and the camera's own state stays due, so it
 * is simply retried next tick.
 *
 * The deadline is deliberately far above any legitimate probe: the slowest real path
 * (external master playlist -> child playlist -> freshness, serially, at 10s timeouts
 * apiece) stays under a minute. Firing early would convert slow-but-honest probes into
 * false failures, which is the exact class of bug this file exists to police.
 */
export const PROBE_SETTLEMENT_DEADLINE_MS = 120 * 1000;

export function guardProbeSettlement(probePromise, {
    deadlineMs = PROBE_SETTLEMENT_DEADLINE_MS,
} = {}) {
    let timer = null;
    const deadline = new Promise((_resolve, reject) => {
        timer = setTimeout(
            () => reject(new Error(`probe_never_settled_within_${deadlineMs}ms`)),
            deadlineMs
        );
        // A pending guard must never be what keeps the process alive.
        timer.unref?.();
    });

    return Promise.race([Promise.resolve(probePromise), deadline]).finally(() => {
        clearTimeout(timer);
    });
}
