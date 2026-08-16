/**
 * Purpose: Let an operator REMOVE a rented camera from the public hub. One direction only.
 * Caller: billingAdminController (POST /api/admin/billing/cameras/:id/unpublish).
 * Deps: connectionPool, cameraService (list cache), cameraAccessService (live access cache),
 *       securityAuditLogger.
 * MainFuncs: unpublishSubscriberCamera.
 * SideEffects: Sets cameras.is_public = 0, invalidates both caches, writes an admin audit row.
 *
 * WHY THERE IS NO MATCHING "PUBLISH"
 * ----------------------------------
 * The two directions are not symmetric, so they do not get one symmetric switch.
 *
 * Publishing a customer's camera puts THEIR property in front of the whole internet. That consent
 * is theirs to give, and they already have the switch in their own portal
 * (customerCameraService.updateOwnCamera). An admin-side publish would add no capability the
 * customer lacks — only a way for it to happen without them — and the damage cannot be recalled:
 * once it was public, people saw it, and the CDN holds segments and thumbnails for a while after.
 *
 * Unpublishing only ever REMOVES exposure. It is the moderation lever an operator genuinely needs
 * — a camera pointed somewhere it should not be must come off the hub without waiting for its
 * owner to answer. Worst case is a hidden camera the customer republishes; no privacy harm can
 * come from this direction.
 *
 * This also follows the grain of the rest of the codebase: customerAccessPolicy denies `customer`
 * by default, and rentalPlaybackAccessPolicy exists precisely so that "is an admin" is never
 * enough to reach a customer's footage. A one-way lever fits that. A two-way one would not.
 *
 * The customer is not locked out: they can publish again from their portal at any time. That is
 * the intended resolution — a disagreement about visibility ends in a conversation, not in the
 * operator holding the only key.
 */

import { queryOne, execute } from '../database/connectionPool.js';
import cameraService from './cameraService.js';
import { invalidateCameraAccessCache } from './cameraAccessService.js';
import { logAdminAction } from './securityAuditLogger.js';

const PROJECTION = 'id, name, camera_class, owner_user_id, billing_status, is_public';

function httpError(message, statusCode) {
    const err = new Error(message);
    err.statusCode = statusCode;
    return err;
}

/**
 * @param {number|string} cameraId
 * @param {object|null} request  for the audit row
 * @returns {{id:number,name:string,camera_class:string,owner_user_id:number|null,
 *            billing_status:string|null,is_public:number,already_private:boolean}}
 */
export function unpublishSubscriberCamera(cameraId, request = null) {
    const id = Number.parseInt(cameraId, 10);
    if (!Number.isInteger(id) || id <= 0) {
        throw httpError('Camera not found', 404);
    }

    const camera = queryOne(`SELECT ${PROJECTION} FROM cameras WHERE id = ?`, [id]);
    if (!camera) {
        throw httpError('Camera not found', 404);
    }
    if (camera.camera_class !== 'subscriber') {
        throw httpError(
            'Jalur ini hanya untuk kamera sewa (subscriber) — kamera community dan owner_private '
            + 'diatur lewat kelas kamera',
            400
        );
    }

    const alreadyPrivate = !(camera.is_public === 1 || camera.is_public === true);
    if (alreadyPrivate) {
        // Not an error: the operator asked for a state the camera is already in. Returning it
        // plainly beats a 400 that makes a no-op look like a failure.
        return { ...camera, already_private: true };
    }

    execute(
        'UPDATE cameras SET is_public = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [id]
    );

    // Both caches. The list cache alone made the camera vanish from public PAGES instantly while
    // its live stream stayed openable to anyone holding the URL for up to the access cache's 30s
    // TTL — the wrong half to leave running when an operator has just taken a camera down.
    invalidateCameraAccessCache(id);
    cameraService.invalidateCameraCache();

    if (request) {
        logAdminAction({
            action: 'billing_camera_unpublished',
            cameraId: id,
            cameraName: camera.name,
            ownerUserId: camera.owner_user_id,
        }, request);
    }

    return { ...queryOne(`SELECT ${PROJECTION} FROM cameras WHERE id = ?`, [id]), already_private: false };
}

export default { unpublishSubscriberCamera };
