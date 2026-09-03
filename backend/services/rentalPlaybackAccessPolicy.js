/**
 * Purpose: Decide who may replay a NON-COMMUNITY camera's recordings — the one deliberate opening in
 *          the "private footage never reaches the public" rule.
 * Caller: recordingPlaybackService.resolvePlaybackAccess, playbackTokenCameraCatalog.
 * Deps: playbackTokenService.
 * MainFuncs: isOwnerIssuedTokenCamera, resolveOwnerScopeAccess, resolveOwnerIssuedTokenAccess.
 * SideEffects: Token validation touches usage counters (delegated to playbackTokenService).
 *
 * WHY THIS IS ITS OWN FILE
 * -----------------------
 * Two reasons, and the second is the real one. It pushed recordingPlaybackService past the 800-line
 * budget, and the project rule is to shrink the change rather than raise the ceiling. But more
 * importantly this is the rule that keeps one customer from watching another customer's house, and
 * it deserves to be readable in one screen instead of buried in the middle of a 900-line service.
 *
 * Everything here answers one question: does this request belong to the person who pays for this
 * camera? Roles are never enough — "is a customer" would open every rental to every customer.
 */

import playbackTokenService from './playbackTokenService.js';

const DITOLAK = {
    accessMode: 'public_denied',
    isPublicPreview: false,
    previewMinutes: 0,
    notice: null,
    contact: null,
    deniedReason: 'camera_admin_only',
};

function unauthorized() {
    const err = new Error('Unauthorized playback access');
    err.statusCode = 401;
    throw err;
}

// A SUBSCRIBER (rental) camera counts as paid ONLY when billing_status is literally 'active' — the same
// rule the public LIVE filter uses (utils/cameraVisibility.js). Treating NULL/'' as paid (the old
// `!billing_status` fallback) let a legacy/never-billed subscriber camera — hidden from live because it
// is not 'active' — still have its private recordings served via an owner-issued share link. Non-rental
// classes (community/owner_private) are not billed, so billing never gates them here.
const masihDibayar = (camera) => camera.camera_class !== 'subscriber' || camera.billing_status === 'active';

/**
 * "Did the person who owns THIS camera mint THIS token?" — the single condition that lets a share
 * link reach non-community footage. Exported because the camera CATALOG the viewer page renders
 * must answer the very same question: a picker that lists a camera the segment gate then refuses
 * is worse than one that never listed it, and two copies of this rule would drift apart.
 *
 * scope_type 'selected' only. Not 'all', not 'area' — a broad token must never widen into private
 * footage just because the issuer happens to own one of the cameras it covers.
 */
export function isOwnerIssuedTokenCamera(camera, token) {
    return !!token
        && !!camera
        && token.scope_type === 'selected'
        && camera.owner_user_id != null
        && Number(token.created_by) === Number(camera.owner_user_id)
        // The gate below refuses a lapsed rental, so a predicate that stopped short of the billing
        // check would have the catalog advertising cameras the segment request then denies.
        && masihDibayar(camera);
}

/**
 * `?scope=owner` — the signed-in owner replaying their own rental camera.
 * Throws 401 rather than falling back to a preview: a wrong answer here must be loud, and a
 * silent downgrade would let a probe distinguish "not yours" from "nothing there".
 */
export function resolveOwnerScopeAccess(camera, request) {
    const userId = request?.user?.id;
    const isOwner = !!userId && Number(camera.owner_user_id) === Number(userId);
    const isRental = camera.camera_class === 'subscriber';

    if (!isOwner || !isRental) {
        unauthorized();
    }

    if (!masihDibayar(camera)) {
        return { ...DITOLAK, deniedReason: 'langganan_tidak_aktif' };
    }

    return {
        accessMode: 'owner_full',
        isPublicPreview: false,
        previewMinutes: null,
        notice: null,
        contact: null,
        deniedReason: null,
    };
}

/**
 * A share link the camera's OWNER minted for THIS camera — the customer handing footage to their
 * staff or to the police without routing it through us.
 *
 * Also the path an operator's own `owner_private` camera takes: the admin who owns it mints a
 * 'selected' link for the family, and it lands here. Nothing about this branch is rental-specific
 * beyond the billing check, which a class with no billing_status passes by definition.
 *
 * One condition, isOwnerIssuedTokenCamera: the issuer owns THIS camera, via a 'selected' token, and
 * the rental is still paid up exactly as for live. (No billing_status = nothing to owe.)
 *
 * Expiry, revocation, session caps and the usage audit are already enforced inside
 * validateRequestForCamera and are deliberately not duplicated here.
 *
 * Returns null when no such token applies; the caller then denies as before.
 */
export function resolveOwnerIssuedTokenAccess(camera, request, options, onRefusal) {
    let token = null;
    try {
        token = playbackTokenService.validateRequestForCamera(request, camera.id, options);
    } catch (error) {
        const statusCode = error?.statusCode;
        if (statusCode !== 401 && statusCode !== 403) throw error;
        onRefusal?.(camera.id, statusCode, error?.message);
        return null;
    }

    if (!isOwnerIssuedTokenCamera(camera, token)) {
        return null;
    }

    return {
        accessMode: 'token_full',
        isPublicPreview: false,
        previewMinutes: null,
        playbackWindowHours: token.effective_playback_window_hours ?? token.playback_window_hours,
        // Carry the absolute range too, so the archive/owner gate can cap an owner-issued 'selected'
        // share to exactly [from, to] — not just the rolling window. Mirrors the community token path.
        playbackFrom: token.playback_from ?? null,
        playbackTo: token.playback_to ?? null,
        tokenId: token.id,
        notice: null,
        contact: null,
        deniedReason: null,
    };
}

export const RENTAL_DENIED = DITOLAK;
