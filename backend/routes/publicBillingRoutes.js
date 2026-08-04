/**
 * Purpose: Register the public (unauthenticated) rental price list under /api/public/billing.
 * Caller: backend/server.js route bootstrap.
 * Deps: publicBillingController, cacheMiddleware.
 * MainFuncs: publicBillingRoutes.
 * SideEffects: Adds one cached read-only Fastify route.
 */

import { listPublicPlans } from '../controllers/publicBillingController.js';
import { cacheMiddleware } from '../middleware/cacheMiddleware.js';

export default async function publicBillingRoutes(fastify) {
    // 60s: a price list changes a few times a year, but the cache must still be short enough that
    // an admin who just edited a price sees it reflected on the sales page while still at the desk.
    fastify.get('/plans', {
        preHandler: cacheMiddleware(60000),
        handler: listPublicPlans,
    });
}
