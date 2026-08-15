/*
 * Purpose: Decide which cameras the playback picker may show, given the public camera list plus
 *          whatever the visitor's playback token says it covers.
 * Caller: Playback page (the single source for its camera list).
 * Deps: cameraDelivery (playback capability).
 * MainFuncs: resolveTokenScopedCameras.
 *
 * WHY A TOKEN CAN NAME A CAMERA THE PUBLIC LIST CANNOT
 * ---------------------------------------------------
 * The public camera list is community-only by project invariant. A 'selected' token minted by a
 * camera's own owner is nevertheless allowed through the segment gate for that owner's private
 * camera. Before this merge the picker filtered the public list down to nothing for such a link:
 * the token was valid, the segments were being served, and the page still had no camera to select.
 *
 * The merge ADDS nothing the server did not already vouch for — `tokenCameras` comes from the
 * activation/heartbeat response, which re-applies the very predicate the segment gate uses. This
 * file must never synthesise a camera entry from an id alone; an id the server declined to describe
 * is an id the visitor is not allowed to know about.
 */

import { getStreamCapabilities } from './cameraDelivery';

function toId(value) {
    const id = Number.parseInt(value, 10);
    return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * @param {object} params
 * @param {Array} params.cameras           public/admin cameras, already filtered to playback-capable
 * @param {Array|null} params.tokenCameras cameras the server says this token covers (null when none)
 * @param {Array|null} params.allowedCameraIds token scope ids, when the token is 'selected'
 * @param {string|undefined} params.scopeType  token scope_type
 * @returns {Array} cameras the picker may offer, public list order first
 */
export function resolveTokenScopedCameras({
    cameras,
    tokenCameras,
    allowedCameraIds,
    scopeType,
} = {}) {
    const base = Array.isArray(cameras) ? cameras : [];
    const extra = Array.isArray(tokenCameras) ? tokenCameras : [];

    let merged = base;
    if (extra.length > 0) {
        const known = new Set(base.map((camera) => toId(camera?.id)));
        // Capability-checked like the public list was: a camera with no playable delivery would
        // sit in the picker and fail on selection, which reads as a broken link, not a limitation.
        const additions = extra.filter((camera) => {
            const id = toId(camera?.id);
            return id !== null && !known.has(id) && getStreamCapabilities(camera).playback;
        });
        merged = additions.length > 0 ? [...base, ...additions] : base;
    }

    if (scopeType !== 'selected' || !Array.isArray(allowedCameraIds)) {
        return merged;
    }

    const allowed = new Set(allowedCameraIds.map(toId).filter((id) => id !== null));
    return merged.filter((camera) => allowed.has(toId(camera?.id)));
}

export default resolveTokenScopedCameras;
