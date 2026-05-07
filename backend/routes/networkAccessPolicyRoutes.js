/**
 * Purpose: Register authenticated admin endpoints for ASN/ISP network access policies.
 * Caller: backend/server.js route bootstrap.
 * Deps: authMiddleware, networkAccessPolicyController.
 * MainFuncs: networkAccessPolicyRoutes.
 * SideEffects: Adds Fastify routes under /api/network-access-policies.
 */

import {
    deleteNetworkAccessPolicy,
    listNetworkAccessPolicies,
    upsertNetworkAccessPolicy,
} from '../controllers/networkAccessPolicyController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

export default async function networkAccessPolicyRoutes(fastify) {
    fastify.get('/', {
        onRequest: [authMiddleware],
        handler: listNetworkAccessPolicies,
    });

    fastify.put('/', {
        onRequest: [authMiddleware],
        schema: {
            body: {
                type: 'object',
                required: ['scope', 'accessFlow', 'mode'],
                properties: {
                    scope: { type: 'string', enum: ['global', 'area', 'camera'] },
                    targetId: {
                        anyOf: [
                            { type: 'integer', minimum: 1 },
                            { type: 'string', minLength: 1 },
                            { type: 'null' },
                        ],
                    },
                    accessFlow: { type: 'string', enum: ['live', 'playback'] },
                    enabled: { type: 'boolean' },
                    mode: { type: 'string', enum: ['observe_only', 'allowlist', 'denylist'] },
                    asnAllowlist: {
                        anyOf: [
                            { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'string' }] } },
                            { type: 'string' },
                        ],
                    },
                    asnDenylist: {
                        anyOf: [
                            { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'string' }] } },
                            { type: 'string' },
                        ],
                    },
                    description: { type: 'string' },
                },
            },
        },
        handler: upsertNetworkAccessPolicy,
    });

    fastify.delete('/:id', {
        onRequest: [authMiddleware],
        schema: {
            params: {
                type: 'object',
                required: ['id'],
                properties: {
                    id: { type: 'string', minLength: 1 },
                },
            },
        },
        handler: deleteNetworkAccessPolicy,
    });
}
