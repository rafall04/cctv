/**
 * Purpose: List the cameras a validated playback token may actually replay, so the public viewer
 *          can render a picker for footage that is NOT on any public camera list.
 * Caller: playbackTokenController (activate + heartbeat).
 * Deps: connectionPool (read-only), rentalPlaybackAccessPolicy (the owner-issued rule).
 * MainFuncs: listTokenPlayableCameras.
 * SideEffects: none — one read-only SELECT.
 *
 * WHY THIS EXISTS
 * ---------------
 * The public playback page builds its camera picker from the PUBLIC camera list, which by invariant
 * contains community cameras only. A 'selected' token minted by a camera's own owner is allowed
 * through the segment gate for that owner's private camera (rentalPlaybackAccessPolicy) — but the
 * camera was never in the list, so the picker filtered down to nothing and the holder of a perfectly
 * valid link saw an empty page. This closes that gap from the authoritative side: the server says
 * which cameras the token covers instead of the client guessing from a list it cannot see.
 *
 * WHAT IT MUST NEVER BECOME
 * The answer is derived from ONE token and re-applies the SAME predicate the segment gate uses. It
 * is not a camera search, it takes no client-supplied filter, and it must stay that way — a picker
 * that lists more than the gate serves is an enumeration oracle for private cameras.
 */

import { query } from '../database/connectionPool.js';
import { isOwnerIssuedTokenCamera } from './rentalPlaybackAccessPolicy.js';

/*
 * A token scoped to hundreds of cameras is a configuration mistake, not a use case, but the id list
 * lands straight in an IN(...) so it gets a ceiling regardless. Cut rather than refuse: the picker
 * degrading to the first 200 beats the whole activation failing.
 */
const MAX_CAMERAS = 200;

function normalizeIds(rawIds) {
    if (!Array.isArray(rawIds)) {
        return [];
    }
    const ids = [...new Set(rawIds
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0))];
    return ids.slice(0, MAX_CAMERAS);
}

/**
 * @param {object|null} token a token already validated by playbackTokenService
 * @returns {Array<{id:number,name:string,area_id:number|null,area_name:string|null,
 *                  camera_class:string,delivery_type:string|null,stream_source:string|null,
 *                  enable_recording:number}>}
 *
 * Empty for every scope except 'selected'. 'all' and 'area' tokens can never reach non-community
 * footage (isOwnerIssuedTokenCamera refuses them), so for those the public list is already the whole
 * truth and a second source would only be a chance to disagree with it.
 */
export function listTokenPlayableCameras(token) {
    if (!token || token.scope_type !== 'selected') {
        return [];
    }

    const cameraIds = normalizeIds(token.allowed_camera_ids);
    if (cameraIds.length === 0) {
        return [];
    }

    const placeholders = cameraIds.map(() => '?').join(', ');
    const rows = query(
        `SELECT c.id, c.name, c.area_id, c.camera_class, c.owner_user_id, c.billing_status,
                c.delivery_type, c.stream_source, c.enable_recording,
                a.name AS area_name
           FROM cameras c
           LEFT JOIN areas a ON a.id = c.area_id
          WHERE c.id IN (${placeholders})
            AND c.enabled = 1
            AND c.enable_recording = 1
          ORDER BY c.id ASC`,
        cameraIds
    );

    return rows
        // Community cameras are already public; anything else rides on the owner-issued rule and
        // nothing else — the same call resolvePlaybackAccess makes, billing check included, so the
        // picker cannot advertise a camera the segment request then refuses. owner_user_id and
        // billing_status are read for that decision and then dropped: the viewer gets a picker
        // entry, not the camera's tenancy record.
        .filter((row) => row.camera_class === 'community' || isOwnerIssuedTokenCamera(row, token))
        .map((row) => ({
            id: row.id,
            name: row.name,
            area_id: row.area_id ?? null,
            area_name: row.area_name ?? null,
            camera_class: row.camera_class,
            delivery_type: row.delivery_type ?? null,
            stream_source: row.stream_source ?? null,
            enable_recording: row.enable_recording,
        }));
}

export default { listTokenPlayableCameras };
