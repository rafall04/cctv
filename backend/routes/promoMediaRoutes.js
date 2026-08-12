/*
Purpose: Serve the generated promo-poster WebP renditions publicly, behind a filename allowlist.
Caller: backend/server.js.
Deps: @fastify/static, promoImageService (storage dir + filename allowlist).
MainFuncs: promoMediaRoutes.
SideEffects: Creates backend/data/promos if absent; adds a static handler under /api/promo-media/.
*/

import fastifyStatic from '@fastify/static';
import { ensurePromoImageDir, PROMO_MEDIA_FILENAME_RE } from '../services/promoImageService.js';

const PREFIX = '/api/promo-media/';

export default async function promoMediaRoutes(fastify, options) {
    /*
     * Unlike thumbnails these files carry no camera data — they are the operator's
     * own advertising — so there is no per-camera access gate. What there IS is a
     * strict filename allowlist, so the static handler is never handed anything but
     * a rendition this app generated.
     *
     * The hook lives inside this plugin rather than at the root, so it applies to
     * exactly the routes registered below and to nothing else.
     */
    fastify.addHook('onRequest', async (request, reply) => {
        const filename = request.url.startsWith(PREFIX)
            ? request.url.slice(PREFIX.length).split('?')[0]
            : '';
        if (!PROMO_MEDIA_FILENAME_RE.test(filename)) {
            reply.header('Cache-Control', 'no-store');
            return reply.code(404).send({ success: false, message: 'Not found' });
        }
    });

    await fastify.register(fastifyStatic, {
        root: ensurePromoImageDir(),
        prefix: PREFIX,
        decorateReply: false,
        /*
         * Safe to cache forever: a replaced poster is written under a NEW random base
         * name and the old files are unlinked, so a cached URL can never go stale in
         * place — the trap that bit meta-config.js when an unhashed filename was
         * served `immutable`.
         */
        setHeaders: (res) => {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        },
    });
}
