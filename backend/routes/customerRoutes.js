/**
 * Purpose: Register the customer-portal API under /api/customer (whitelisted in
 *          customerAccessPolicy — everything else stays customer-locked).
 * Caller: backend/server.js route bootstrap.
 * Deps: customerController, authMiddleware (+requireCustomerOrAdmin).
 * MainFuncs: customerRoutes.
 * SideEffects: Adds Fastify routes.
 */

import {
    getMyCameras,
    getMySummary,
    getMyWallet,
    createTopup,
    getTopupStatus,
    getMyPayments,
} from '../controllers/customerController.js';
import { authMiddleware, requireCustomerOrAdmin } from '../middleware/authMiddleware.js';

export default async function customerRoutes(fastify) {
    const guard = [authMiddleware, requireCustomerOrAdmin];

    fastify.get('/cameras', { onRequest: guard }, getMyCameras);
    fastify.get('/summary', { onRequest: guard }, getMySummary);
    fastify.get('/wallet', { onRequest: guard }, getMyWallet);
    fastify.get('/payments', { onRequest: guard }, getMyPayments);

    fastify.post('/topup', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['amount'],
                properties: {
                    amount: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
        },
    }, createTopup);

    fastify.get('/topup/:id', {
        onRequest: guard,
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string', pattern: '^[0-9]+$' },
                },
            },
        },
    }, getTopupStatus);
}
