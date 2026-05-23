/*
Purpose: Register admin sponsor package catalog routes.
Caller: backend/server.js, mounted under /api/sponsor-packages.
Deps: sponsorPackageController, authMiddleware/requireAdmin, schemaValidators.
MainFuncs: sponsorPackageRoutes.
SideEffects: Adds admin-only sponsor package CRUD routes to Fastify.
*/

import {
    listPackages,
    createPackage,
    updatePackage,
    deletePackage,
} from '../controllers/sponsorPackageController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import {
    createSponsorPackageSchema,
    updateSponsorPackageSchema,
} from '../middleware/schemaValidators.js';

export default async function sponsorPackageRoutes(fastify) {
    // GET list is admin-only too — exposes default_price, which is internal
    // catalog data, not a public listing. Public sponsor surfaces (footer
    // strip, badge) already get the package label/color enriched via the
    // /api/sponsors/active response so they don't need this catalog.
    fastify.get('/', { preHandler: [authMiddleware, requireAdmin] }, listPackages);

    fastify.post('/', {
        preHandler: [authMiddleware, requireAdmin],
        schema: createSponsorPackageSchema,
    }, createPackage);

    fastify.put('/:id', {
        preHandler: [authMiddleware, requireAdmin],
        schema: updateSponsorPackageSchema,
    }, updatePackage);

    fastify.delete('/:id', {
        preHandler: [authMiddleware, requireAdmin],
    }, deletePackage);
}
