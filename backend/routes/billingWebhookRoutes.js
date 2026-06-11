/**
 * Purpose: Public payment-gateway webhook endpoints (verified inside paymentService).
 * Caller: backend/server.js route bootstrap; Midtrans / iPaymu HTTP notifications.
 * Deps: paymentService, node:querystring (iPaymu posts form-urlencoded).
 * MainFuncs: billingWebhookRoutes.
 * SideEffects: Settlement webhooks credit wallets and resume cameras (exactly once).
 *
 * Security: this path is exempt from CSRF + API-key (machine-to-machine).
 *   - Midtrans: authenticated by the SHA-512 signature over
 *     order_id+status_code+gross_amount+server_key; invalid → 403, no writes.
 *   - iPaymu: callbacks carry no signature, so the body is treated as a HINT only —
 *     payment state changes exclusively after a signed re-query to the iPaymu API.
 */

import querystring from 'querystring';
import paymentService from '../services/paymentService.js';

export default async function billingWebhookRoutes(fastify) {
    // iPaymu notifies with application/x-www-form-urlencoded, which Fastify does
    // not parse by default. Scoped to this plugin only.
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

    fastify.post('/webhook/midtrans', async (request, reply) => {
        try {
            const result = paymentService.handleMidtransWebhook(request.body || {});
            return reply.send({ success: true, ...result });
        } catch (error) {
            if (error.statusCode === 403) {
                return reply.code(403).send({ success: false, message: 'Invalid signature' });
            }
            console.error('Midtrans webhook error:', error);
            return reply.code(500).send({ success: false, message: 'Webhook processing failed' });
        }
    });

    fastify.post('/webhook/ipaymu', async (request, reply) => {
        try {
            const result = await paymentService.handleIpaymuWebhook(request.body || {});
            return reply.send({ success: true, ...result });
        } catch (error) {
            console.error('iPaymu webhook error:', error);
            return reply.code(500).send({ success: false, message: 'Webhook processing failed' });
        }
    });
}
