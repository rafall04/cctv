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
    getMyPlan,
    listAvailablePlans,
    switchMyPlan,
    createMyCamera,
    updateMyCamera,
    deleteMyCamera,
    getPaymentOptions,
    listMyAreas,
    createMyArea,
    deleteMyArea,
} from '../controllers/customerController.js';
import { authMiddleware, requireCustomerOrAdmin } from '../middleware/authMiddleware.js';

const cameraIdParam = {
    params: {
        type: 'object',
        required: ['id'],
        properties: {
            id: { type: 'string', pattern: '^[0-9]+$' },
        },
    },
};

const cameraBodyProperties = {
    name: { type: 'string', minLength: 2, maxLength: 100 },
    location: { type: 'string', maxLength: 120 },
    description: { type: 'string', maxLength: 200 },
    private_rtsp_url: { type: 'string', minLength: 8, maxLength: 500 },
    // LocationPicker emits fixed(6) strings; allow empty string to clear. Range is
    // re-validated in customerCameraService with friendly messages.
    latitude: { type: ['number', 'string'], maxLength: 32 },
    longitude: { type: ['number', 'string'], maxLength: 32 },
    // Customer's own area (customer_areas.id) or '' / null to clear. Ownership is
    // validated in the service so a guessed id can't attach to another tenant's area.
    customer_area_id: { type: ['integer', 'string', 'null'] },
};

export default async function customerRoutes(fastify) {
    const guard = [authMiddleware, requireCustomerOrAdmin];

    fastify.get('/cameras', { onRequest: guard }, getMyCameras);
    fastify.get('/summary', { onRequest: guard }, getMySummary);
    fastify.get('/wallet', { onRequest: guard }, getMyWallet);
    fastify.get('/payments', { onRequest: guard }, getMyPayments);
    fastify.get('/payment-options', { onRequest: guard }, getPaymentOptions);

    // Plan (paket) self-service
    fastify.get('/plan', { onRequest: guard }, getMyPlan);
    fastify.get('/plans', { onRequest: guard }, listAvailablePlans);
    fastify.post('/plan', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['plan_key'],
                properties: {
                    plan_key: { type: 'string', minLength: 2, maxLength: 40 },
                },
                additionalProperties: false,
            },
        },
    }, switchMyPlan);

    // Camera self-service (bounded by plan max_cameras + RTSP policy)
    fastify.post('/cameras', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['name', 'private_rtsp_url'],
                properties: cameraBodyProperties,
                additionalProperties: false,
            },
        },
    }, createMyCamera);

    fastify.put('/cameras/:id', {
        onRequest: guard,
        schema: {
            ...cameraIdParam,
            body: {
                type: 'object',
                properties: cameraBodyProperties,
                additionalProperties: false,
            },
        },
    }, updateMyCamera);

    fastify.delete('/cameras/:id', {
        onRequest: guard,
        schema: cameraIdParam,
    }, deleteMyCamera);

    // "Area Saya" — per-customer private grouping (separate namespace from public areas)
    fastify.get('/areas', { onRequest: guard }, listMyAreas);
    fastify.post('/areas', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['name'],
                properties: {
                    name: { type: 'string', minLength: 1, maxLength: 40 },
                },
                additionalProperties: false,
            },
        },
    }, createMyArea);
    fastify.delete('/areas/:id', { onRequest: guard, schema: cameraIdParam }, deleteMyArea);

    fastify.post('/topup', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['amount'],
                properties: {
                    amount: { type: 'integer', minimum: 1 },
                    method: { type: 'string', maxLength: 40 },
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
