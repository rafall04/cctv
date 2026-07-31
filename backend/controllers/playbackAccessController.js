/**
 * Purpose: Public playback-access endpoints — list packages, claim the free trial, open an iPaymu
 *          order, poll it, and receive the gateway notify.
 * Caller: playbackAccessRoutes (/api/playback-access/*).
 * Deps: playbackProductService, playbackTrialService, playbackOrderService, voucherPass (device cookie).
 * MainFuncs: getProducts, claimTrial, createOrder, getOrderStatus, handleIpaymuWebhook.
 *
 * Device identity reuses the SAME signed `vdev` cookie the voucher flow issues. One device, one
 * identity across both products: a buyer who already holds a voucher pass is not asked to establish a
 * second one, and "one trial per device" cannot be sidestepped by bouncing between the two pages.
 *
 * Every response here is per-device and must never be shared or edge-cached — hence the explicit
 * `private, no-store` on anything that reflects device state.
 */

import playbackProductService from '../services/playbackProductService.js';
import playbackTrialService from '../services/playbackTrialService.js';
import playbackOrderService from '../services/playbackOrderService.js';
import {
    readVoucherDeviceHash,
    generateDeviceHash,
    setVoucherDeviceCookie,
} from '../services/voucherPass.js';

/** Read the device identity, minting and setting the cookie when this is a first visit. */
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
    const message = code === 500 || !error?.message ? fallbackMessage : error.message;
    if (code === 500) console.error('[PlaybackAccess]', error);
    return reply.code(code).send({ success: false, message });
}

/** GET /api/playback-access/products — catalogue plus this device's trial eligibility. */
export async function getProducts(request, reply) {
    try {
        const deviceHash = ensureDevice(request, reply);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({
            success: true,
            data: {
                products: playbackProductService.listPublic(),
                trial: playbackTrialService.getStatus(deviceHash),
            },
        });
    } catch (error) {
        return fail(reply, error, 'Gagal memuat daftar paket');
    }
}

/** POST /api/playback-access/trial — one free trial per device. */
export async function claimTrial(request, reply) {
    try {
        const deviceHash = ensureDevice(request, reply);
        const issued = playbackTrialService.claim(deviceHash, { ip: request.ip });
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({
            success: true,
            message: 'Masa coba gratis aktif.',
            data: {
                shareKey: issued.share_key,
                expiresAt: issued.data?.expires_at || null,
                windowHours: issued.data?.playback_window_hours || null,
            },
        });
    } catch (error) {
        return fail(reply, error, 'Gagal mengaktifkan masa coba');
    }
}

/** POST /api/playback-access/order { productKey, name?, phone?, methodKey? } */
export async function createOrder(request, reply) {
    try {
        const deviceHash = ensureDevice(request, reply);
        const { productKey, name = null, phone = null, methodKey = null } = request.body || {};
        const order = await playbackOrderService.createOrder(productKey, {
            name,
            phone,
            deviceHash,
            methodKey,
            ip: request.ip,
        });
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({ success: true, data: order });
    } catch (error) {
        return fail(reply, error, 'Gagal membuat pembayaran');
    }
}

/** GET /api/playback-access/order/:id — visible only to the device that opened it. */
export async function getOrderStatus(request, reply) {
    try {
        const deviceHash = readVoucherDeviceHash(request);
        const order = await playbackOrderService.getOwnedOrderStatus(request.params.id, deviceHash);
        reply.header('Cache-Control', 'private, no-store');
        return reply.send({ success: true, data: order });
    } catch (error) {
        return fail(reply, error, 'Gagal memeriksa status pembayaran');
    }
}

/**
 * POST /api/playback-access/webhook/ipaymu — gateway notify.
 *
 * Always answers 200. iPaymu retries anything else, and a retry storm helps nobody: the body is
 * untrusted anyway, so a failure here means "we could not look it up", not "the payment is invalid".
 * The buyer's own polling reaches the same syncOrder path and heals it.
 */
export async function handleIpaymuWebhook(request, reply) {
    try {
        const result = await playbackOrderService.handleWebhook(request.body || {});
        return reply.send({ success: true, ...result });
    } catch (error) {
        console.error('[PlaybackAccess] webhook error:', error);
        return reply.send({ success: false, handled: false });
    }
}
