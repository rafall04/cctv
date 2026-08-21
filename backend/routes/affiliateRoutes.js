/*
Purpose: Register every affiliate endpoint — two public routes, twelve admin-only ones, and (nested)
         the /api/affiliate-media/ static handler for product photos.
Caller: backend/routes/commerceRoutes.js, registered WITHOUT a prefix (all paths below are absolute,
        same style as settingsRoutes/promoBannerRoutes) so ONE registration line mounts the feature.
Deps: affiliateController, authMiddleware/requireAdmin, promoImageService (upload ceiling),
      affiliateMediaRoutes.
MainFuncs: affiliateRoutes (default export, a single Fastify plugin).
SideEffects: Adds 14 routes plus the nested media handler. No DB access here — routes stay thin
             (guardrails.test.js enforces it).

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

WHY THE MEDIA HANDLER IS NESTED HERE
------------------------------------
server.js has one line of headroom and this feature already spent it. routes/affiliateMediaRoutes.js
is therefore registered from inside this plugin — the same trick promoBannerRoutes uses for
promoMediaRoutes — so the whole affiliate feature, images included, still costs the caller a single
`await fastify.register(affiliateRoutes)`.

THE ONE ROUTE ALLOWED A BODY OVER THE GLOBAL 1MB CAP
----------------------------------------------------
POST /api/admin/affiliate/offers/:id/image carries a base64 product photo. Its `bodyLimit` below
must stay in agreement with the matching entry in middleware/inputSanitizer.js LARGE_BODY_ROUTES,
which is matched on METHOD + WHOLE PATH (never a prefix — a prefix would hand the allowance to
every admin affiliate route, including the ones an unauthenticated caller can reach the hook of).
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
    uploadAffiliateOfferImage,
    getAffiliateOfferStats,
} from '../controllers/affiliateController.js';
import { authMiddleware, requireAdmin } from '../middleware/authMiddleware.js';
import { MAX_AFFILIATE_UPLOAD_BYTES } from '../services/promoImageService.js';
import affiliateMediaRoutes from './affiliateMediaRoutes.js';

const PUBLIC_BASE = '/api/public/affiliate';
const ADMIN_BASE = '/api/admin/affiliate';

// base64 inflates by 4/3; add headroom for the surrounding JSON envelope. Same arithmetic as
// promoBannerRoutes, applied to the AFFILIATE ceiling (5 MiB today, deliberately its own constant
// so a future product-photo limit can move without touching posters): 7344128 bytes.
const UPLOAD_BODY_LIMIT = Math.ceil(MAX_AFFILIATE_UPLOAD_BYTES * 1.4) + 4096;

export default async function affiliateRoutes(fastify, options) {
    // Product photos live under their own prefix; registering them here rather than in server.js
    // keeps the whole feature at one registration line. See the header.
    await fastify.register(affiliateMediaRoutes);

    /* ---------------------------------------------------------------- public */

    /*
     * Resolve one offer for one viewing context. The response is a hand-built allow-list of
     * thirteen keys, built in the service — the visible content, the real outbound URLs, the /go
     * hrefs, a prebuilt wa.me link, the price, the photo. Never partner_id, targeting, schedule,
     * priority, stats, the operator's own contact note, the fee charged to the shop, and above all
     * NO camera or area field: a public commerce slot must not become a way to enumerate cameras.
     * Uncacheable by design (the handler sets Cache-Control: no-store); never wire cacheMiddleware
     * to it, since a replayed response would replay the impression it was counted for.
     */
    fastify.get(`${PUBLIC_BASE}/offer`, getPublicAffiliateOffer);

    /*
     * Two jobs, one event. `?beacon=1` -> 204 and a counted tap (l=p|s|w), gated on Sec-Fetch-Site
     * being same-origin/same-site; without it -> the no-JS 302 for l=p|s (never 301 — see the
     * controller header for why a cached permanent redirect would be unrevokable), 404 for l=w.
     * Why the beacon gate is the stricter of the two is argued at length in the controller header.
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

    /*
     * Product photo upload. The ONLY affiliate route allowed a body over the global 1MB cap, and
     * the limit here must agree with middleware/inputSanitizer.js LARGE_BODY_ROUTES (8MiB there,
     * 7344128 bytes here — the route is the tighter of the two, so ffmpeg is never handed a body
     * the sanitizer would have let through). Clearing the photo is a normal offer update with
     * image_base = null: presence is the switch, there is no show_image flag to keep in sync.
     */
    fastify.post(`${ADMIN_BASE}/offers/:id/image`, {
        preHandler: [authMiddleware, requireAdmin],
        bodyLimit: UPLOAD_BODY_LIMIT,
    }, uploadAffiliateOfferImage);

    // Daily rollup for one offer. Registered after /offers/:id so the static segment is explicit;
    // Fastify's radix router resolves this unambiguously either way.
    fastify.get(`${ADMIN_BASE}/offers/:id/stats`, adminOnly, getAffiliateOfferStats);
}
