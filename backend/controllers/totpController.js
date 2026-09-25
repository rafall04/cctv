/*
 * Purpose: Self-service TOTP management — status, enrollment (setup → confirm), and
 *          disable. Each handler uses request.user.id, so any authenticated role manages
 *          only their OWN second factor (the session JWT is the credential).
 * Caller: userRoutes.js under /api/users/totp/* (whitelisted for customers in
 *         middleware/customerAccessPolicy.js).
 * Deps: totpAuthService.
 * MainFuncs: getTotpStatus, startTotpSetup, confirmTotpSetup, disableTotp.
 */

import totpAuthService from '../services/totpAuthService.js';

const errReply = (reply, error) => {
    const status = error.statusCode || 500;
    if (status >= 500) console.error('[TOTP]', error);
    return reply.code(status).send({ success: false, message: status >= 500 ? 'Internal server error' : error.message });
};

export async function getTotpStatus(request, reply) {
    try {
        return reply.send({ success: true, data: totpAuthService.getStatus(request.user.id) });
    } catch (error) {
        return errReply(reply, error);
    }
}

/**
 * Returns the secret + otpauth URL + QR ONCE. The seed stays disabled until
 * confirmTotpSetup verifies a live code — a half-finished enrollment never locks
 * anyone out.
 */
export async function startTotpSetup(request, reply) {
    try {
        const data = await totpAuthService.startSetup(request.user.id, request.user.username, request);
        return reply.send({ success: true, data });
    } catch (error) {
        return errReply(reply, error);
    }
}

/** {code} → enables 2FA and returns the recovery codes exactly this one time. */
export async function confirmTotpSetup(request, reply) {
    try {
        const code = request.body?.code;
        if (!code) return reply.code(400).send({ success: false, message: 'code wajib diisi' });
        const data = totpAuthService.confirmSetup(request.user.id, code, request);
        return reply.send({ success: true, data });
    } catch (error) {
        return errReply(reply, error);
    }
}

/** {code} — a live TOTP or a recovery code; the password alone is never enough. */
export async function disableTotp(request, reply) {
    try {
        const code = request.body?.code;
        if (!code) return reply.code(400).send({ success: false, message: 'code wajib diisi' });
        const data = totpAuthService.disable(request.user.id, code, request);
        return reply.send({ success: true, data });
    } catch (error) {
        return errReply(reply, error);
    }
}
