/**
 * Purpose: Loopback-only MediaMTX push-hook endpoint (Phase 3). MediaMTX fires runOnReady /
 *          runOnNotReady on each always_on path's source transition; this endpoint maps the path
 *          ($MTX_PATH = camera stream_key) to a camera and asks the health service to re-check it
 *          IMMEDIATELY, so a customer's camera dying/recovering is seen in ~seconds instead of a
 *          poll cycle.
 * Caller: backend/server.js route registration at prefix /api/internal; MediaMTX curl over loopback.
 * Deps: config (shared secret), csrfProtection.timingSafeEqual, connectionPool.queryOne,
 *       cameraHealthService (the actual re-check).
 * MainFuncs: handleMediaMtxPathEvent.
 *
 * SECURITY / SAFETY MODEL — read before changing:
 *  - A hook only TRIGGERS cameraHealthService.checkCamera(), which runs the SAME weighted evaluation
 *    the poller uses. The verdict never comes from the hook. So a missed, failed, or even SPOOFED
 *    hook can never produce a wrong camera status — the worst it can do is cause extra re-checks.
 *  - The shared secret + loopback gate therefore exist to prevent a local process from spamming
 *    re-checks (DoS/MediaMTX-API load), not to protect correctness.
 *  - Defense in depth: constant-time secret compare (primary) + reject non-loopback socket peer +
 *    reject any X-Forwarded-For (a genuine same-host MediaMTX call has none; an nginx-proxied
 *    external call would). The backend binds 0.0.0.0, and nginx also 403s /api/internal/, so this
 *    in-app gate is the real boundary.
 */

import { config } from '../config/config.js';
import { timingSafeEqual } from '../middleware/csrfProtection.js';
import { queryOne } from '../database/connectionPool.js';
import cameraHealthService from '../services/cameraHealthService.js';
import MediaMtxHookTrigger from '../services/mediaMtxHookTrigger.js';

// Module-level singleton so the debounce + in-flight cap persist across requests. A hook only TRIGGERS
// this real re-check; the verdict comes from checkCamera's own weighted evaluation (see the file
// header's safety model), so coalescing/dropping events here can never produce a wrong status.
const hookTrigger = new MediaMtxHookTrigger({ check: (id) => cameraHealthService.checkCamera(id) });

const VALID_EVENTS = new Set(['ready', 'notready']);
// stream_key is a UUID; the legacy fallback path name is `camera<id>` / `camera_<id>`. Accept that
// charset only — anything else cannot be one of our path names, so reject before touching the DB.
const PATH_NAME_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isLoopbackPeer(addr) {
    if (!addr) {
        return false;
    }
    // Normalise IPv4-mapped IPv6 (::ffff:127.0.0.1) and bare IPv6 loopback.
    const ip = addr.replace(/^::ffff:/i, '');
    return ip === '127.0.0.1' || ip === '::1' || ip === '0000:0000:0000:0000:0000:0000:0000:0001';
}

export async function handleMediaMtxPathEvent(request, reply) {
    const secret = config.security.internalHookSecret;
    // Feature is opt-in: no secret => hooks disabled. Report 503 so a misconfigured hook is visible
    // in MediaMTX logs, without leaking whether a secret exists.
    if (!secret) {
        return reply.code(503).send({ success: false, message: 'push hooks disabled' });
    }

    // Constant-time secret compare FIRST (before any work), then loopback + no-XFF defense in depth.
    const provided = request.headers['x-internal-secret'];
    const peer = request.socket?.remoteAddress || '';
    const forwarded = request.headers['x-forwarded-for'];
    if (
        !timingSafeEqual(typeof provided === 'string' ? provided : '', secret)
        || !isLoopbackPeer(peer)
        || forwarded
    ) {
        return reply.code(403).send({ success: false, message: 'forbidden' });
    }

    const event = request.query?.event;
    const path = request.query?.path;
    // Always ACK with 200 once authenticated — MediaMTX only cares that the notify was delivered, and
    // an unmapped/invalid path is a legitimate no-op (reserved names, a just-deleted camera), not an
    // error to surface in MediaMTX's log. Validation failures below simply skip the re-check.
    if (VALID_EVENTS.has(event) && typeof path === 'string' && PATH_NAME_RE.test(path)) {
        // Reverse map path -> camera (stream_key is UNIQUE-indexed). Only enabled cameras get a
        // re-check; reserved names (all/all_others/health) and deleted cameras simply won't match.
        const camera = queryOne('SELECT id FROM cameras WHERE stream_key = ? AND enabled = 1', [path]);
        if (camera) {
            // Fire-and-forget: onEvent returns immediately (it schedules the async checkCamera itself,
            // with its own debounce + in-flight cap).
            hookTrigger.onEvent(camera.id, event);
        }
    }

    return reply.code(200).send({ success: true });
}
