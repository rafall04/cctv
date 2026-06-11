/**
 * Purpose: Public payment-gateway webhook endpoint (signature-verified inside paymentService).
 * Caller: backend/server.js route bootstrap; Midtrans HTTP notifications.
 * Deps: paymentService.
 * MainFuncs: billingWebhookRoutes.
 * SideEffects: Settlement webhooks credit wallets and resume cameras (exactly once).
 *
 * Security: this path is exempt from CSRF + API-key (machine-to-machine) — the
 * SHA-512 signature over order_id+status_code+gross_amount+server_key is the
 * authentication. Invalid signatures get 403 and touch nothing.
 */

import paymentService from '../services/paymentService.js';

export default async function billingWebhookRoutes(fastify) {
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
}
