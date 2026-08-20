/*
Purpose: Register provider promo-banner endpoints — public resolve/click plus admin CRUD + upload.
Caller: backend/server.js, registered WITHOUT a prefix (paths below are absolute, same as
        settingsRoutes) so this one registration also mounts the poster static handler.
Deps: promoBannerController, authMiddleware/requireAdmin, promoImageService (upload size), promoMediaRoutes.
MainFuncs: promoBannerRoutes.
SideEffects: Adds two public routes, six admin-only routes, and the /api/promo-media/ static handler.
*/

import {
    getPublicPromoBanner,
    trackPromoBannerClick,
    listPromoBanners,
    getPromoBanner,
    createPromoBanner,
    updatePromoBanner,
    uploadPromoBannerImage,
    deletePromoBanner,
    getPromoBannerStats,
} from '../controllers/promoBannerController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import { MAX_PROMO_UPLOAD_BYTES } from '../services/promoImageService.js';
import promoMediaRoutes from './promoMediaRoutes.js';

// base64 inflates by 4/3; add headroom for the surrounding JSON envelope.
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_PROMO_UPLOAD_BYTES * 1.4) + 4096;

const BASE = '/api/promo-banners';

export default async function promoBannerRoutes(fastify, options) {
    // Poster files live under their own prefix, so they are registered here rather
    // than costing server.js another line.
    await fastify.register(promoMediaRoutes);

    /*
     * Public reads. Only the fields the poster itself needs are returned
     * (title, alt text, image base, CTA) — never scheduling, targeting, contact
     * numbers, or stats.
     *
     * On cameras: the resolver looks a camera up to find its area, and the name it reads DOES
     * reach the caller — buildWhatsAppUrl substitutes `{kamera}` into the public cta_url. What
     * makes that safe is not this endpoint's shape but the `camera_class = 'community'` filter on
     * that lookup, whose names are already public on the landing page. A non-community id finds
     * nothing and is therefore indistinguishable from an id that does not exist. If you touch
     * that query, that property is what you must preserve.
     */
    fastify.get(`${BASE}/public`, getPublicPromoBanner);
    fastify.post(`${BASE}/:id/click`, trackPromoBannerClick);

    // Admin-only. The full rows carry targeting, schedule, the operator's
    // WhatsApp number, and impression/click figures.
    fastify.get(BASE, {
        preHandler: [authMiddleware, requireAdmin]
    }, listPromoBanners);

    fastify.get(`${BASE}/:id`, {
        preHandler: [authMiddleware, requireAdmin]
    }, getPromoBanner);

    fastify.get(`${BASE}/:id/stats`, {
        preHandler: [authMiddleware, requireAdmin]
    }, getPromoBannerStats);

    fastify.post(BASE, {
        preHandler: [authMiddleware, requireAdmin]
    }, createPromoBanner);

    fastify.put(`${BASE}/:id`, {
        preHandler: [authMiddleware, requireAdmin]
    }, updatePromoBanner);

    // The one route allowed a body over the global 1MB cap — see the matching
    // allowance in middleware/inputSanitizer.js, which must agree with this limit.
    fastify.post(`${BASE}/:id/image`, {
        preHandler: [authMiddleware, requireAdmin],
        bodyLimit: UPLOAD_BODY_LIMIT,
    }, uploadPromoBannerImage);

    fastify.delete(`${BASE}/:id`, {
        preHandler: [authMiddleware, requireAdmin]
    }, deletePromoBanner);
}
