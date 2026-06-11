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
    listPlansAdmin,
    createPlan,
    updatePlan,
    changeCustomerPlan,
    getRegistrationSettings,
    updateRegistrationSettings,
    listRegistrations,
    approveRegistration,
    rejectRegistration,
    getPaymentGateway,
    updatePaymentGateway,
    testPaymentGateway,
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

    // Plan catalog (paket) + trial customization
    fastify.get('/plans', { onRequest: guard }, listPlansAdmin);
    fastify.post('/plans', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['key', 'name', 'price_per_camera', 'max_cameras'],
                properties: {
                    key: { type: 'string', minLength: 2, maxLength: 40 },
                    name: { type: 'string', minLength: 2, maxLength: 60 },
                    description: { type: 'string', maxLength: 200 },
                    price_per_camera: { type: 'integer', minimum: 0 },
                    max_cameras: { type: 'integer', minimum: 1, maximum: 100 },
                    is_trial: { type: 'boolean' },
                    trial_days: { type: ['integer', 'null'], minimum: 1, maximum: 90 },
                    active: { type: 'boolean' },
                    sort_order: { type: 'integer' },
                },
                additionalProperties: false,
            },
        },
    }, createPlan);
    fastify.put('/plans/:id', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                properties: {
                    name: { type: 'string', minLength: 2, maxLength: 60 },
                    description: { type: 'string', maxLength: 200 },
                    price_per_camera: { type: 'integer', minimum: 0 },
                    max_cameras: { type: 'integer', minimum: 1, maximum: 100 },
                    is_trial: { type: 'boolean' },
                    trial_days: { type: ['integer', 'null'], minimum: 1, maximum: 90 },
                    active: { type: 'boolean' },
                    sort_order: { type: 'integer' },
                },
                additionalProperties: false,
            },
        },
    }, updatePlan);

    // Change a customer's plan (admin override — may pick inactive plans / re-grant trial)
    fastify.put('/customers/:id/plan', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                properties: {
                    plan_key: { type: 'string', minLength: 2, maxLength: 40 },
                    plan_id: { type: 'integer', minimum: 1 },
                },
                additionalProperties: false,
            },
        },
    }, changeCustomerPlan);

    // Pending self-registrations awaiting approval
    fastify.get('/registrations', { onRequest: guard }, listRegistrations);
    fastify.post('/registrations/:id/approve', { onRequest: guard, schema: idParamSchema }, approveRegistration);
    fastify.post('/registrations/:id/reject', { onRequest: guard, schema: idParamSchema }, rejectRegistration);

    // Payment gateway config (active gateway, iPaymu/Midtrans creds, enabled methods/banks).
    // Body schema is intentionally permissive (nested methods array); the service validates.
    fastify.get('/payment-gateway', { onRequest: guard }, getPaymentGateway);
    fastify.put('/payment-gateway', { onRequest: guard }, updatePaymentGateway);
    fastify.post('/payment-gateway/test', { onRequest: guard }, testPaymentGateway);

    // Self-registration settings (enabled + default plan for new signups)
    fastify.get('/registration-settings', { onRequest: guard }, getRegistrationSettings);
    fastify.put('/registration-settings', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                properties: {
                    enabled: { type: 'boolean' },
                    default_plan_key: { type: 'string', minLength: 2, maxLength: 40 },
                },
                additionalProperties: false,
            },
        },
    }, updateRegistrationSettings);
}
