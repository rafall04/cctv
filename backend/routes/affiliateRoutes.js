/*
Purpose: Register every affiliate endpoint — two public routes plus eleven admin-only ones.
Caller: backend/server.js, registered WITHOUT a prefix (all paths below are absolute, same style as
        settingsRoutes/promoBannerRoutes) so ONE registration line mounts the whole feature.
Deps: affiliateController, authMiddleware/requireAdmin.
MainFuncs: affiliateRoutes (default export, a single Fastify plugin).
SideEffects: Adds 13 routes. No DB access here — routes stay thin (guardrails.test.js enforces it).

WHY ABSOLUTE PATHS AND A SINGLE PLUGIN
--------------------------------------
server.js sits at 799 lines against a frozen 800-line ratchet, i.e. exactly one line of headroom.
Anything that needed two registrations, or a `{ prefix }` option split across public and admin
trees, would not fit. Absolute paths inside one plugin cost the caller exactly:

    await fastify.register(affiliateRoutes);

WHY THE TWO BASES DIFFER (this is load-bearing, not cosmetic)
-------------------------------------------------------------
  /api/admin/affiliate/*  -> middleware/rateLimiter.js buckets by prefix and its
                             RATE_LIMIT_CONFIG.adminPrefixes is exactly ['/api/admin']. A different
                             base would drop admin CRUD into the 100/min PUBLIC bucket, shared with
                             anonymous visitors.
  /api/public/affiliate/* -> middleware/apiKeyValidator.js whitelists the PREFIX '/api/public/'.
                             The existing promo public route (/api/promo-banners/public) is not in
                             that list, which is a latent bug; it is not repeated here.

Role gating: middleware/customerAccessPolicy.js denies the `customer` role by default outside its
whitelist, and /api/admin is not in it — so subscriber accounts cannot reach these handlers even
before requireAdmin runs. The public pair is intentionally unauthenticated: it is what an anonymous
visitor watching a camera hits.
*/

import {
    getPublicAffiliateOffer,
    goAffiliateOffer,
    listAffiliatePartners,
    getAffiliatePartner,
    createAffiliatePartner,
    updateAffiliatePartner,
    deleteAffiliatePartner,
    listAffiliateOffers,
    getAffiliateOffer,
    createAffiliateOffer,
    updateAffiliateOffer,
    deleteAffiliateOffer,
    getAffiliateOfferStats,
} from '../controllers/affiliateController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';

const PUBLIC_BASE = '/api/public/affiliate';
const ADMIN_BASE = '/api/admin/affiliate';

export default async function affiliateRoutes(fastify, options) {
    /* ---------------------------------------------------------------- public */

    /*
     * Resolve one offer for one viewing context. The response is a hand-built allow-list of six
     * keys (id, product_title, description, store_name, product_href, store_href) built in the
     * service — no partner_id, no targeting, no schedule, no price, no contact note, and above all
     * NO camera or area field: a public commerce slot must not become a way to enumerate cameras.
     * Uncacheable by design (the handler sets Cache-Control: no-store); never wire cacheMiddleware
     * to it, since a replayed response would replay the impression it was counted for.
     */
    fastify.get(`${PUBLIC_BASE}/offer`, getPublicAffiliateOffer);

    /*
     * The only path from a visitor to a partner's site. Re-checks liveness on every hit and answers
     * 302 (never 301 — see the controller header for why a cached permanent redirect would be
     * unrevokable). Counts only real navigations.
     */
    fastify.get(`${PUBLIC_BASE}/offers/:id/go`, goAffiliateOffer);

    /* ----------------------------------------------------------------- admin */

    const adminOnly = { preHandler: [authMiddleware, requireAdmin] };

    // Partners: the commercial counterparty. Rows carry price, schedule and contact notes, which is
    // precisely why none of this shares a handler with the public resolver.
    fastify.get(`${ADMIN_BASE}/partners`, adminOnly, listAffiliatePartners);
    fastify.post(`${ADMIN_BASE}/partners`, adminOnly, createAffiliatePartner);
    fastify.get(`${ADMIN_BASE}/partners/:id`, adminOnly, getAffiliatePartner);
    fastify.put(`${ADMIN_BASE}/partners/:id`, adminOnly, updateAffiliatePartner);
    fastify.delete(`${ADMIN_BASE}/partners/:id`, adminOnly, deleteAffiliatePartner);

    // Offers: the content shown to visitors, plus its targeting and placements.
    fastify.get(`${ADMIN_BASE}/offers`, adminOnly, listAffiliateOffers);
    fastify.post(`${ADMIN_BASE}/offers`, adminOnly, createAffiliateOffer);
    fastify.get(`${ADMIN_BASE}/offers/:id`, adminOnly, getAffiliateOffer);
    fastify.put(`${ADMIN_BASE}/offers/:id`, adminOnly, updateAffiliateOffer);
    fastify.delete(`${ADMIN_BASE}/offers/:id`, adminOnly, deleteAffiliateOffer);

    // Daily rollup for one offer. Registered after /offers/:id so the static segment is explicit;
    // Fastify's radix router resolves this unambiguously either way.
    fastify.get(`${ADMIN_BASE}/offers/:id/stats`, adminOnly, getAffiliateOfferStats);
}
