/*
Purpose: Serve the generated affiliate product-photo WebP renditions publicly, behind a filename
         allowlist — the affiliate twin of promoMediaRoutes.
Caller: backend/routes/affiliateRoutes.js (nested there, NOT registered from server.js).
Deps: @fastify/static, promoImageService (shared storage helpers + the affiliate filename allowlist).
MainFuncs: affiliateMediaRoutes.
SideEffects: Creates backend/data/affiliate if absent; adds a static handler under /api/affiliate-media/.

WHY THIS IS A SEPARATE PREFIX AND NOT A FOLDER UNDER /api/promo-media/
----------------------------------------------------------------------
Both trees are "operator-supplied images", but they answer to different people: the promo poster is
the provider's own advertising, an affiliate photo belongs to a partner shop whose contract can
end. Keeping the URL spaces apart means a partner's files can be retired, audited or blocked
without touching the provider's, and one allowlist regex can never accidentally admit the other
feature's filenames. The pipeline is shared (promoImageService with the affiliate options); the
door is not.

WHY THIS FILE IS REGISTERED FROM affiliateRoutes.js
---------------------------------------------------
server.js is at 799 lines against a frozen 800-line ratchet — it cannot afford a registration line.
promoBannerRoutes already nests promoMediaRoutes for exactly this reason; this repeats the
precedent rather than inventing a second convention.

A NOTE ON API-KEY VALIDATION (a known, pre-existing gap — not introduced here)
------------------------------------------------------------------------------
middleware/apiKeyValidator.js whitelists PREFIXES, and '/api/affiliate-media/' is not one of them —
exactly like the existing '/api/promo-media/' and '/api/promo-banners/public'. It is invisible in
practice only because API key validation passes through when no key row exists. If that knob is
ever tightened (API_KEY_REQUIRE_KEYS=true), all three break together, and they should be fixed
together in that middleware rather than by moving image files under /api/public/.
*/

import fastifyStatic from '@fastify/static';
import {
    ensurePromoImageDir,
    AFFILIATE_IMAGE_OPTIONS,
    AFFILIATE_MEDIA_FILENAME_RE,
} from '../services/promoImageService.js';

const PREFIX = '/api/affiliate-media/';

export default async function affiliateMediaRoutes(fastify, options) {
    /*
     * These files carry no camera data — they are a shop's product photo — so there is no
     * per-camera access gate. What there IS is a strict filename allowlist, so the static handler
     * is never handed anything but a rendition this app generated (`aff-<hex>-320.webp` /
     * `-160.webp`). Everything else 404s before @fastify/static sees a path.
     *
     * The hook lives inside this plugin rather than at the root, so it applies to exactly the
     * route registered below and to nothing else.
     */
    fastify.addHook('onRequest', async (request, reply) => {
        const filename = request.url.startsWith(PREFIX)
            ? request.url.slice(PREFIX.length).split('?')[0]
            : '';
        if (!AFFILIATE_MEDIA_FILENAME_RE.test(filename)) {
            reply.header('Cache-Control', 'no-store');
            return reply.code(404).send({ success: false, message: 'Not found' });
        }
    });

    await fastify.register(fastifyStatic, {
        root: ensurePromoImageDir(AFFILIATE_IMAGE_OPTIONS),
        prefix: PREFIX,
        decorateReply: false,
        /*
         * Cache headers come from the plugin's own options, NOT a `setHeaders` callback.
         * @fastify/static invokes that callback as `setHeaders(reply, path, stat)` — a Fastify
         * Reply, which has `.header()` and no `.setHeader()`. Calling the Node API on it throws
         * inside the send pump, after the route matched, so the request never gets a response at
         * all: every image request HUNG rather than failing loudly. That shipped once on the promo
         * side; do not reintroduce it here.
         *
         * Safe to cache forever: a replaced photo is written under a NEW random base name and the
         * old files are unlinked, so a cached URL can never go stale in place — the trap that bit
         * meta-config.js when an unhashed filename was served `immutable`.
         */
        cacheControl: true,
        maxAge: 31536000000,
        immutable: true,
    });
}
