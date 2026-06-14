/**
 * Purpose: Public voucher endpoints — redeem a code (→ issue device cookie + unlock areas) and read
 *          the current gate state for this device. Thin glue over voucherService + voucherPass.
 * Caller: voucherRoutes (/api/voucher/*).
 * Deps: voucherService (domain logic), voucherPass (signed device cookie).
 * MainFuncs: getVoucherAccess, redeemVoucher.
 */

import voucherService from '../services/voucherService.js';
import {
    readVoucherDeviceHash,
    setVoucherDeviceCookie,
    generateDeviceHash,
} from '../services/voucherPass.js';

/**
 * GET /api/voucher/access — public gate snapshot for this device:
 * { enabled, gated_area_ids, accessible_area_ids }. The frontend renders a lock on a camera whose
 * area is gated but not accessible. Cheap + safe to poll; never reveals codes.
 */
export async function getVoucherAccess(request, reply) {
    try {
        const deviceHash = readVoucherDeviceHash(request);
        const data = voucherService.getPublicGateState({ deviceHash });
        // Per-device snapshot — must never be shared/edge-cached.
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({ success: true, data });
    } catch (error) {
        console.error('Voucher access error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * POST /api/voucher/redeem { code, name?, phone? } — redeem on THIS device, set the signed device
 * cookie, return the unlocked area ids. A single generic error is returned for every
 * not-redeemable case so the endpoint is not a code-existence oracle.
 */
export async function redeemVoucher(request, reply) {
    let deviceHash = readVoucherDeviceHash(request);
    if (!deviceHash) {
        deviceHash = generateDeviceHash();
    }

    try {
        const { code, name = null, phone = null } = request.body || {};
        const result = voucherService.redeemCode(code, { name, phone, deviceHash });

        // (Re)issue the device cookie so the live gate recognizes this device going forward.
        setVoucherDeviceCookie(request, reply, deviceHash);
        reply.header('Cache-Control', 'private, no-store');

        return reply.send({
            success: true,
            data: {
                status: result.status,
                expires_at: result.expires_at,
                area_ids: result.area_ids,
            },
        });
    } catch (error) {
        if (error.statusCode === 400 || error.statusCode === 404) {
            // Generic message (no oracle): do not distinguish invalid / revoked / expired / quota.
            return reply.code(400).send({
                success: false,
                message: 'Kode voucher tidak valid atau sudah tidak berlaku.',
            });
        }
        console.error('Voucher redeem error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal menukar kode voucher' });
    }
}

export default { getVoucherAccess, redeemVoucher };
