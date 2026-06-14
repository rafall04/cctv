/**
 * Purpose: Public voucher routes — redeem a code and read the per-device gate state.
 * Caller: backend/server.js route registration at prefix /api/voucher.
 * Deps: voucherController.
 * MainFuncs: voucherRoutes (default export).
 *
 * Both endpoints are PUBLIC (anonymous visitors). POST /redeem is CSRF-protected like every other
 * public state-changing POST (the SPA attaches the CSRF token). Rate-limiting is handled by the
 * global rate limiter; tighten per-IP/device limits here when the self-serve flow lands (Phase 3).
 */

import {
    getVoucherAccess,
    redeemVoucher,
    createVoucherOrder,
    getVoucherOrderStatus,
} from '../controllers/voucherController.js';

export default async function voucherRoutes(fastify) {
    fastify.get('/access', getVoucherAccess);

    fastify.post('/redeem', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    code: { type: 'string', minLength: 4, maxLength: 32 },
                    name: { type: 'string', maxLength: 100 },
                    phone: { type: 'string', maxLength: 30 },
                },
                required: ['code'],
            },
        },
    }, redeemVoucher);

    // Self-serve payment (Phase 3). CSRF-protected like every public POST (SPA attaches the token);
    // the webhook lives at /api/voucher/webhook (separate plugin, CSRF-exempt).
    fastify.post('/order', {
        schema: {
            body: {
                type: 'object',
                properties: {
                    profileId: { type: 'integer', minimum: 1 },
                    name: { type: 'string', maxLength: 100 },
                    phone: { type: 'string', maxLength: 30 },
                    methodKey: { type: 'string', maxLength: 40 },
                },
                required: ['profileId'],
            },
        },
    }, createVoucherOrder);

    fastify.get('/order/:id/status', getVoucherOrderStatus);
}
