/**
 * Purpose: Fire-and-forget playback failure telemetry to the anonymous public endpoint.
 *          The server can see a 200 on the segment URL while the viewer's decoder chokes —
 *          without this, "everyone fails on camera X" is invisible until somebody complains.
 * Caller: pages/Playback.jsx error paths (source error event, seek-stall timeout).
 * Deps: config.getApiUrl.
 * MainFuncs: reportPlaybackFailure.
 * SideEffects: One POST per unique failure signature per page load, hard-capped — a retry loop
 *              in the player must never become a write flood on our own endpoint.
 */

import { getApiUrl } from '../config/config.js';

const MAX_REPORTS_PER_SESSION = 20;
const sentSignatures = new Set();
let sentCount = 0;

const buildSignature = (e) => [e.stage, e.errorCode ?? '', e.cameraId ?? '', e.segment ?? ''].join('|');

/**
 * @param {object} event
 * @param {'source_load'|'seek_stall'|'buffer_stall'|'unknown'} event.stage
 * @param {string} [event.errorCode]  classified client error (e.g. 'codec', 'media_err_4')
 * @param {number} [event.cameraId]
 * @param {string} [event.scope]      playback access scope (public_preview/token_full/…)
 * @param {string} [event.segment]    segment filename — a corrupt file many viewers hit is the signal
 * @returns {boolean} whether a report was dispatched
 */
export function reportPlaybackFailure(event) {
    if (!event || !event.stage) return false;
    const signature = buildSignature(event);
    if (sentSignatures.has(signature) || sentCount >= MAX_REPORTS_PER_SESSION) return false;
    sentSignatures.add(signature);
    sentCount += 1;

    const body = JSON.stringify(event);

    // fetch(keepalive) first — the page may be navigating away; sendBeacon stays the fallback for
    // browsers without keepalive (same lesson as affiliateService.countAffiliateClick).
    try {
        if (typeof fetch === 'function') {
            fetch(`${getApiUrl()}/api/public/playback-telemetry`, {
                method: 'POST',
                keepalive: true,
                credentials: 'omit',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body,
            }).catch(() => {});
            return true;
        }
    } catch {
        /* fall through to the beacon transport */
    }

    try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
            return navigator.sendBeacon(`${getApiUrl()}/api/public/playback-telemetry`, new Blob([body], { type: 'application/json' })) === true;
        }
    } catch {
        /* no transport left — an unreported failure is not the visitor's problem */
    }
    return false;
}

export function resetPlaybackTelemetryForTests() {
    sentSignatures.clear();
    sentCount = 0;
}
