/*
Purpose: Group the commercial surfaces — the provider's own promo poster and the affiliate
         partner offers — behind ONE registration, because they are the same kind of thing and
         because server.js cannot afford a second.
Caller: backend/server.js (one import line, one register line).
Deps: promoBannerRoutes (which itself nests promoMediaRoutes), affiliateRoutes.
MainFuncs: commerceRoutes (default export, a single Fastify plugin).
SideEffects: Registers both route trees. No routes of its own, no DB access.

WHY THIS FILE EXISTS AT ALL
---------------------------
server.js was at 799 lines against a 800-line budget — one line of headroom, and a new feature
needs two (an import and a register). Rather than push server.js over the budget, this swaps the
existing promo pair for a commerce pair: server.js is unchanged in length, and affiliate rides in
with it. The precedent is inside promoBannerRoutes.js itself, which already nests promoMediaRoutes
with the comment "registered here rather than costing server.js another line" — this generalises
that trick one level up instead of hiding affiliate inside a file named after promo banners.

WHY GROUPED AS "COMMERCE" AND NOT SOMETHING VAGUER
--------------------------------------------------
Both trees put paid or promotional content in front of a public visitor, and both therefore share
the rules that matter here: honesty labelling on the public surface, no camera field in a public
payload, and admin-only authoring. Anything that does NOT meet those rules does not belong in this
file. The name is the constraint, not just a folder.

NOT A PLACE TO PUT LOGIC
------------------------
guardrails.test.js enforces that routes do not reach the database. This file goes further and
declares no routes of its own — if you find yourself adding a handler here, it belongs in the tree
it serves.
*/

import promoBannerRoutes from './promoBannerRoutes.js';
import affiliateRoutes from './affiliateRoutes.js';

export default async function commerceRoutes(fastify, options) {
    await fastify.register(promoBannerRoutes, options);
    await fastify.register(affiliateRoutes, options);
}
