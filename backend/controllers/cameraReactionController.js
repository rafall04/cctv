/**
 * Purpose: Public endpoints for the one-tap camera verdict — read this device's vote, cast it.
 * Caller: publicCameraFeedbackRoutes (/api/public/cameras/:id/reaction).
 * Deps: cameraReactionService, voucherPass (device cookie).
 * MainFuncs: getCameraReaction, setCameraReaction.
 * SideEffects: Writes camera_reactions; may set the device cookie on a first visit.
 *
 * Device identity reuses the SAME signed `vdev` cookie the voucher and playback-access flows issue.
 * One device, one identity across every public feature: a visitor who already holds a playback
 * trial does not establish a second one here, and "one vote per device" cannot be sidestepped by
 * bouncing between pages.
 *
 * Responses are per-device, so they must never be shared or edge-cached — hence `private, no-store`.
 */

import cameraReactionService from '../services/cameraReactionService.js';
import {
    readVoucherDeviceHash,
    generateDeviceHash,
    setVoucherDeviceCookie,
} from '../services/voucherPass.js';

function ensureDevice(request, reply) {
    let deviceHash = readVoucherDeviceHash(request);
    if (!deviceHash) {
        deviceHash = generateDeviceHash();
        setVoucherDeviceCookie(request, reply, deviceHash);
    }
    return deviceHash;
}

function fail(reply, error, fallbackMessage) {
    const code = error?.statusCode || 500;
    if (code === 500) console.error('[CameraReaction]', error);
    return reply.code(code).send({
        success: false,
        message: code === 500 ? fallbackMessage : error.message,
    });
}

/** GET /api/public/cameras/:id/reaction — the count, plus what this device already voted. */
export async function getCameraReaction(request, reply) {
    try {
        const deviceHash = readVoucherDeviceHash(request);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({
            success: true,
            // No cookie minted on a plain read: a visitor who only ever looks should not be given
            // an identity for it.
            data: cameraReactionService.getPublicSummary(Number(request.params.id), deviceHash),
        });
    } catch (error) {
        return fail(reply, error, 'Gagal memuat reaksi kamera');
    }
}

/** POST /api/public/cameras/:id/reaction { value: 1 | -1 | 0 } */
export async function setCameraReaction(request, reply) {
    try {
        const deviceHash = ensureDevice(request, reply);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({
            success: true,
            data: cameraReactionService.setReaction(
                Number(request.params.id),
                deviceHash,
                request.body?.value,
            ),
        });
    } catch (error) {
        return fail(reply, error, 'Gagal menyimpan reaksi');
    }
}
