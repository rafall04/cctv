/*
 * Purpose: Single source of truth for "which cameras are visible on PUBLIC LIVE surfaces"
 *          (landing, map, stream list, area pages, trending, discovery, thumbnails).
 * Caller: cameraService, publicGrowthService, areaService, streamService — every public
 *         camera-list query interpolates PUBLIC_LIVE_SQL instead of inlining the rule, so
 *         the visibility policy can never drift between surfaces.
 * Deps: none (a SQL fragment string).
 *
 * Rule: a camera is public-live-visible when it is a community camera, OR a subscriber
 * camera the owner has published (is_public = 1) AND that is actively paid
 * (billing_status = 'active') — a suspended public camera drops off public automatically.
 * owner_private is never public. NOTE: this is LIVE only; public PLAYBACK stays
 * community-only (subscriber product is live-only even when published).
 *
 * Assumes the cameras table is aliased `c` in the query.
 */

export const PUBLIC_LIVE_SQL =
    "(c.camera_class = 'community' OR (c.camera_class = 'subscriber' AND c.is_public = 1 AND c.billing_status = 'active'))";

export default { PUBLIC_LIVE_SQL };
