/**
 * Purpose: Loopback-only internal hook routes (Phase 3 MediaMTX push health). Separate plugin at a
 *          dedicated /api/internal prefix so it can be exempted from API-key + CSRF (machine-to-machine,
 *          self-authenticated by shared secret + loopback gate in the controller) without loosening
 *          anything else. nginx additionally 403s /api/internal/ from outside.
 * Caller: backend/server.js route registration at prefix /api/internal; MediaMTX curl over loopback.
 * Deps: internalHookController.
 * MainFuncs: internalHookRoutes (default export).
 */

import { handleMediaMtxPathEvent } from '../controllers/internalHookController.js';

export default async function internalHookRoutes(fastify) {
    // GET (not POST): MediaMTX runs the hook as a bare `curl` with no body — GET sidesteps any
    // empty-POST content-type handling, is verified to arrive intact through MediaMTX, and is
    // naturally CSRF-exempt. The endpoint mutates nothing directly; it only triggers a re-check.
    fastify.get('/mediamtx/path-event', handleMediaMtxPathEvent);
}
