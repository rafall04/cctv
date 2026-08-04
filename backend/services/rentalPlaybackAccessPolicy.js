/**
 * Purpose: Decide who may replay a RENTED camera's recordings — the one deliberate opening in the
 *          "subscriber product is live-only" rule.
 * Caller: recordingPlaybackService.resolvePlaybackAccess.
 * Deps: playbackTokenService.
 * MainFuncs: resolveOwnerScopeAccess, resolveOwnerIssuedTokenAccess.
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

const masihDibayar = (camera) => !camera.billing_status || camera.billing_status === 'active';

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
 * Three conditions, all required:
 *  - scope_type 'selected'. Not 'all', not 'area'. (There is no 'camera' scope in this system;
 *    assuming that name would have made this branch dead code that never matched.)
 *  - the issuer owns THIS camera. Not "is a customer", not "is an admin".
 *  - the rental is still paid up, exactly as for live.
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

    const diterbitkanPemilik = token
        && token.scope_type === 'selected'
        && camera.owner_user_id != null
        && Number(token.created_by) === Number(camera.owner_user_id);

    if (!diterbitkanPemilik || !masihDibayar(camera)) {
        return null;
    }

    return {
        accessMode: 'token_full',
        isPublicPreview: false,
        previewMinutes: null,
        playbackWindowHours: token.effective_playback_window_hours ?? token.playback_window_hours,
        tokenId: token.id,
        notice: null,
        contact: null,
        deniedReason: null,
    };
}

export const RENTAL_DENIED = DITOLAK;
