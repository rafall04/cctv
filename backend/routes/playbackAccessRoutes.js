/**
 * Purpose: Register public playback-access endpoints (catalogue, trial claim, iPaymu order, notify).
 * Caller: server.js, mounted at /api/playback-access.
 * Deps: playbackAccessController.
 * MainFuncs: playbackAccessRoutes.
 *
 * Bodies stay schema-light on purpose: playbackOrderService owns the real validation (product exists,
 * is purchasable, price > 0) and returns operator-readable Indonesian messages. Duplicating those
 * rules here would let the two drift apart, and the service is the side that money depends on.
 */

import {
    getProducts,
    claimTrial,
    createOrder,
    getOrderStatus,
    handleIpaymuWebhook,
} from '../controllers/playbackAccessController.js';

export default async function playbackAccessRoutes(fastify) {
    fastify.get('/products', getProducts);
    fastify.post('/trial', claimTrial);

    fastify.post('/order', {
        schema: {
            body: {
                type: 'object',
                required: ['productKey'],
                properties: {
                    productKey: { type: 'string', maxLength: 32 },
                    name: { type: ['string', 'null'], maxLength: 80 },
                    phone: { type: ['string', 'null'], maxLength: 24 },
                    methodKey: { type: ['string', 'null'], maxLength: 32 },
                },
                additionalProperties: false,
            },
        },
    }, createOrder);

    fastify.get('/order/:id', {
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: { id: { type: 'integer', minimum: 1 } },
            },
        },
    }, getOrderStatus);

    // No body schema: the gateway decides its own payload shape, and rejecting an unexpected field
    // would turn a harmless notify into a retry loop. The handler treats it as untrusted regardless.
    fastify.post('/webhook/ipaymu', handleIpaymuWebhook);
}
