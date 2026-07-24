/*
 * Purpose: One canonical online/offline/maintenance tally for the public landing so
 *          the navbar pulse, the hero status deck, and Simple mode all report the SAME
 *          numbers. Previously Full mode (LandingStatsBar) and Simple mode
 *          (SimpleStatusOverview) computed "online" differently and disagreed on
 *          degraded/maintenance cameras.
 * Caller: LandingNavbar, the status deck, and Simple mode overview.
 * Deps: getCameraAvailabilityState from cameraAvailability.js.
 * MainFuncs: getPublicCameraStats.
 * SideEffects: None.
 */

import { getCameraAvailabilityState } from './cameraAvailability.js';

/**
 * Tally a public camera list into mutually-exclusive buckets that sum to total.
 * "online" counts up cameras (online + degraded); maintenance and hard-offline are
 * split out — matching the original LandingStatsBar semantics.
 * @returns {{ online:number, offline:number, maintenance:number, total:number }}
 */
export function getPublicCameraStats(cameras = []) {
    const list = Array.isArray(cameras) ? cameras : [];
    let online = 0;
    let offline = 0;
    let maintenance = 0;

    list.forEach((camera) => {
        const state = getCameraAvailabilityState(camera);
        if (state === 'maintenance') {
            maintenance += 1;
        } else if (state === 'offline') {
            offline += 1;
        } else {
            online += 1;
        }
    });

    return { online, offline, maintenance, total: list.length };
}
