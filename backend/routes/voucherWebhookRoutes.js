/**
 * Purpose: Public voucher payment webhook (iPaymu notify). Separate plugin so it can carry its own
 *          form-urlencoded parser and be CSRF-exempt (machine-to-machine), without affecting the
 *          JSON voucher routes.
 * Caller: backend/server.js route registration at prefix /api/voucher/webhook; iPaymu HTTP notify.
 * Deps: node:querystring, voucherController.
 * MainFuncs: voucherWebhookRoutes (default export).
 *
 * Security: exempt from CSRF (see CSRF_SKIP_ENDPOINTS '/api/voucher/webhook'). iPaymu callbacks carry
 * no verifiable signature, so the handler treats the body as a HINT only — it re-queries the iPaymu
 * API before issuing anything (voucherOrderService).
 */

import querystring from 'querystring';
import { handleVoucherIpaymuWebhook } from '../controllers/voucherController.js';

export default async function voucherWebhookRoutes(fastify) {
    // iPaymu notifies with application/x-www-form-urlencoded; scoped to this plugin only.
    fastify.addContentTypeParser(
        'application/x-www-form-urlencoded',
        { parseAs: 'string', bodyLimit: 64 * 1024 },
        (request, body, done) => {
            try {
                done(null, querystring.parse(body));
            } catch (error) {
                done(error, undefined);
            }
        }
    );

    fastify.post('/ipaymu', handleVoucherIpaymuWebhook);
}
