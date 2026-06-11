/**
 * Purpose: Register admin billing routes under /api/admin/billing (requireAdmin everywhere).
 * Caller: backend/server.js route bootstrap.
 * Deps: billingAdminController, authMiddleware.
 * MainFuncs: billingAdminRoutes.
 * SideEffects: Adds Fastify routes.
 */

import {
    listCustomers,
    manualTopup,
    listSubscriptions,
    assignSubscription,
    updateSubscription,
    setCameraClass,
    listPayments,
    markPaymentPaid,
    runCharges,
} from '../controllers/billingAdminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const idParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', pattern: '^[0-9]+$' },
        },
    },
};

export default async function billingAdminRoutes(fastify) {
    const guard = [authMiddleware, requireAdmin];

    fastify.get('/customers', { onRequest: guard }, listCustomers);

    fastify.post('/topup-manual', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['user_id', 'amount'],
                properties: {
                    user_id: { type: 'integer', minimum: 1 },
                    amount: { type: 'integer', minimum: 1000 },
                    note: { type: 'string', maxLength: 200 },
                },
                additionalProperties: false,
            },
        },
    }, manualTopup);

    fastify.get('/subscriptions', { onRequest: guard }, listSubscriptions);

    fastify.post('/subscriptions', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['camera_id', 'user_id', 'monthly_price'],
                properties: {
                    camera_id: { type: 'integer', minimum: 1 },
                    user_id: { type: 'integer', minimum: 1 },
                    monthly_price: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
        },
    }, assignSubscription);

    fastify.put('/subscriptions/:id', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                properties: {
                    monthly_price: { type: 'integer', minimum: 1 },
                    status: { type: 'string', enum: ['active', 'suspended', 'cancelled'] },
                },
                additionalProperties: false,
            },
        },
    }, updateSubscription);

    fastify.put('/cameras/:id/class', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                required: ['camera_class'],
                properties: {
                    camera_class: { type: 'string', enum: ['community', 'owner_private'] },
                    owner_user_id: { type: ['integer', 'null'], minimum: 1 },
                },
                additionalProperties: false,
            },
        },
    }, setCameraClass);

    fastify.get('/payments', { onRequest: guard }, listPayments);
    fastify.post('/payments/:id/mark-paid', { onRequest: guard, schema: idParamSchema }, markPaymentPaid);
    fastify.post('/charges/run', { onRequest: guard }, runCharges);
}
