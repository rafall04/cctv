/**
 * Purpose: Device-pass cookie for voucher-gated area access — the bearer credential a redeemed
 *          device presents so the live gate (canViewLive) recognizes it. The value is a random,
 *          unguessable device id (stored in voucher_redemptions.device_hash); it is set as a
 *          SIGNED, httpOnly cookie so it cannot be tampered with and is invisible to JS. It rides
 *          same-origin on every /hls + /api/stream request, so HLS segment fetches carry it without
 *          the player needing to attach anything.
 * Caller: voucherController (issue on redeem), and the live-stream choke points (read on each
 *         request): hlsProxyRoutes, externalStreamProxyService, hlsProxyService.
 * Deps: node:crypto, @fastify/cookie (registered in server.js with config.jwt.secret →
 *       request.unsignCookie / reply.setCookie({ signed: true })), authCookieOptions.isHttpsRequest.
 * MainFuncs: generateDeviceHash, readVoucherDeviceHash, setVoucherDeviceCookie.
 */

import crypto from 'crypto';
import { isHttpsRequest } from '../utils/authCookieOptions.js';

export const VOUCHER_DEVICE_COOKIE = 'vdev';

// Long-lived: the cookie only IDENTIFIES the device; actual access is governed by the codes the
// device has redeemed (their expiry/revocation), re-checked on every request by the gate.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 60; // 60 days

/** 48 hex chars (24 bytes) — unguessable, so the cookie functions as a bearer token. */
export function generateDeviceHash() {
    return crypto.randomBytes(24).toString('hex');
}

/**
 * Read + verify the signed device cookie. Returns the device hash, or null when absent/invalid/
 * tampered. Never throws (a malformed cookie must not break a public stream request).
 */
export function readVoucherDeviceHash(request) {
    try {
        const raw = request?.cookies?.[VOUCHER_DEVICE_COOKIE];
        if (!raw || typeof raw !== 'string') {
            return null;
        }
        const unsigned = request.unsignCookie(raw);
        return unsigned && unsigned.valid && unsigned.value ? unsigned.value : null;
    } catch {
        return null;
    }
}

/** Issue (or refresh) the signed device cookie. Secure flag follows the actual request protocol. */
export function setVoucherDeviceCookie(request, reply, deviceHash) {
    reply.setCookie(VOUCHER_DEVICE_COOKIE, deviceHash, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isHttpsRequest(request),
        signed: true,
        maxAge: COOKIE_MAX_AGE_SECONDS,
    });
}

export default { VOUCHER_DEVICE_COOKIE, generateDeviceHash, readVoucherDeviceHash, setVoucherDeviceCookie };
