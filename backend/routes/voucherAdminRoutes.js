/**
 * Purpose: Admin routes for voucher area-access management under /api/admin/voucher (requireAdmin).
 * Caller: backend/server.js route bootstrap.
 * Deps: voucherAdminController, authMiddleware.
 * MainFuncs: voucherAdminRoutes.
 *
 * Profile create/update bodies are intentionally schema-light — voucherService.normalizeProfilePayload
 * validates (incl. the area_ids array and duration_value/unit alternatives).
 */

import {
    getVoucherSettings,
    updateVoucherSettings,
    setAreaGated,
    listProfiles,
    createProfile,
    updateProfile,
    deleteProfile,
    generateCodes,
    listCodes,
    revokeCode,
} from '../controllers/voucherAdminController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const idParamSchema = {
    params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', pattern: '^[0-9]+$' } },
    },
};

export default async function voucherAdminRoutes(fastify) {
    const guard = [authMiddleware, requireAdmin];

    // Global feature flag + which areas are currently gated.
    fastify.get('/settings', { onRequest: guard }, getVoucherSettings);
    fastify.put('/settings', {
        onRequest: guard,
        schema: {
            body: {
                type: 'object',
                required: ['enabled'],
                properties: { enabled: { type: 'boolean' } },
                additionalProperties: false,
            },
        },
    }, updateVoucherSettings);

    // Mark/unmark an area as "berbayar" (gated).
    fastify.put('/areas/:id/gate', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                required: ['gated'],
                properties: { gated: { type: 'boolean' } },
                additionalProperties: false,
            },
        },
    }, setAreaGated);

    // Voucher profiles (template). Service validates create/update bodies.
    fastify.get('/profiles', { onRequest: guard }, listProfiles);
    fastify.post('/profiles', { onRequest: guard }, createProfile);
    fastify.put('/profiles/:id', { onRequest: guard, schema: idParamSchema }, updateProfile);
    fastify.delete('/profiles/:id', { onRequest: guard, schema: idParamSchema }, deleteProfile);

    // Codes: generate a batch for a profile, list, revoke.
    fastify.post('/profiles/:id/codes', {
        onRequest: guard,
        schema: {
            ...idParamSchema,
            body: {
                type: 'object',
                properties: {
                    count: { type: 'integer', minimum: 1, maximum: 500 },
                    source: { type: 'string', enum: ['admin', 'self'] },
                    buyer_name: { type: 'string', maxLength: 100 },
                    buyer_phone: { type: 'string', maxLength: 30 },
                },
                additionalProperties: false,
            },
        },
    }, generateCodes);
    fastify.get('/codes', { onRequest: guard }, listCodes);
    fastify.post('/codes/:id/revoke', { onRequest: guard, schema: idParamSchema }, revokeCode);
}
