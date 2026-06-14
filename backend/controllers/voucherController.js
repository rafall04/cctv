/**
 * Purpose: Public voucher endpoints — redeem a code (→ issue device cookie + unlock areas) and read
 *          the current gate state for this device. Thin glue over voucherService + voucherPass.
 * Caller: voucherRoutes (/api/voucher/*).
 * Deps: voucherService (domain logic), voucherPass (signed device cookie).
 * MainFuncs: getVoucherAccess, redeemVoucher.
 */

import voucherService from '../services/voucherService.js';
import voucherOrderService from '../services/voucherOrderService.js';
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

/**
 * POST /api/voucher/order { profileId, name?, phone?, methodKey? } — open a self-serve iPaymu QRIS
 * payment for a voucher profile, charged to THIS device. Sets the device cookie up-front so the same
 * device receives access on confirmation. Returns the order + QR payload for the claim page to render.
 */
export async function createVoucherOrder(request, reply) {
    let deviceHash = readVoucherDeviceHash(request);
    if (!deviceHash) {
        deviceHash = generateDeviceHash();
    }
    try {
        const { profileId, name = null, phone = null, methodKey = null } = request.body || {};
        const order = await voucherOrderService.createOrder(profileId, { name, phone, deviceHash, methodKey, ip: request.ip });
        setVoucherDeviceCookie(request, reply, deviceHash);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({ success: true, data: order });
    } catch (error) {
        if (error.statusCode === 429) {
            return reply.code(429).send({ success: false, message: error.message });
        }
        if (error.statusCode === 503) {
            return reply.code(503).send({ success: false, message: error.message });
        }
        if (error.statusCode === 400 || error.statusCode === 404) {
            return reply.code(400).send({ success: false, message: error.message });
        }
        console.error('Create voucher order error:', error);
        return reply.code(500).send({ success: false, message: 'Gagal membuat order pembayaran' });
    }
}

/**
 * GET /api/voucher/order/:id/status — claim-page poll. Re-checks the gateway and, once paid, returns
 * the issued voucher (code + area_ids); the device cookie set at order creation already grants access.
 * Visible only to the device that created the order.
 */
export async function getVoucherOrderStatus(request, reply) {
    try {
        const { id } = request.params;
        const deviceHash = readVoucherDeviceHash(request);
        const order = await voucherOrderService.getOwnedOrderStatus(id, deviceHash);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({ success: true, data: order });
    } catch (error) {
        if (error.statusCode === 404) {
            return reply.code(404).send({ success: false, message: 'Order tidak ditemukan' });
        }
        console.error('Voucher order status error:', error);
        return reply.code(500).send({ success: false, message: 'Internal server error' });
    }
}

/**
 * POST /api/voucher/webhook/ipaymu — iPaymu notify (form-urlencoded, no signature). The body is a
 * HINT only: the order is re-verified against the iPaymu API before anything is issued.
 */
export async function handleVoucherIpaymuWebhook(request, reply) {
    try {
        const result = await voucherOrderService.handleWebhook(request.body || {});
        return reply.send({ success: true, ...result });
    } catch (error) {
        console.error('Voucher iPaymu webhook error:', error);
        return reply.code(500).send({ success: false, message: 'Webhook processing failed' });
    }
}

export default {
    getVoucherAccess,
    redeemVoucher,
    createVoucherOrder,
    getVoucherOrderStatus,
    handleVoucherIpaymuWebhook,
};
