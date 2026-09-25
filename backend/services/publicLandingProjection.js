/*
 * Purpose: Strip internal health/runtime/policy fields from a public landing camera object
 *          AFTER availability enrichment, so GET /api/cameras/active stays lean and never
 *          leaks internal monitoring/health state to the public surface.
 * Caller: cameraService.getPublicLandingCameraList (final .map in the read-model pipeline).
 * Deps: logRedaction (stripUrlCredentials).
 * MainFuncs: stripInternalLandingFields.
 * SideEffects: none (returns a shallow copy; never mutates the input).
 *
 * Why here (not in cameraService.js): the public card keys off `availability_state` /
 * `is_online`, and the popup resolver uses `availability_*`. The fields below are consumed
 * only by backend enrichment (to derive availability) or by admin surfaces (which use a
 * separate admin projection), so they are internal to the public payload. Enrichment runs
 * BEFORE this strip, so removing them here does not affect availability computation.
 * `stream_key` is already omitted from PUBLIC_LANDING_CAMERA_PROJECTION, so it is not listed.
 */

import { stripUrlCredentials } from '../utils/logRedaction.js';
import { getEffectiveDeliveryType, DELIVERY_TYPE_PATTERNS } from '../utils/cameraDelivery.js';

export const PUBLIC_LANDING_INTERNAL_FIELDS = [
    'monitoring_state',
    'monitoring_reason',
    'last_runtime_signal_at',
    'last_runtime_signal_type',
    'last_health_check_at',
    'runtime_state_updated_at',
    'health_mode',
    'external_health_mode',
    'area_external_health_mode_override',
];

/*
 * Origin URLs of proxied external streams.
 *
 * `external_use_proxy = 1` means every viewer is supposed to reach the feed through the
 * backend `/hls` proxy — that is what enforces access control, hides the third party from
 * our traffic, and lets us keep serving when the origin blocks a hotlink. Publishing the
 * origin `.m3u8` in GET /api/cameras/active handed anyone who opened the endpoint a way
 * straight past all of it.
 *
 * Only stripped when the client provably does not need the URL:
 *   - `delivery_type` is exactly 'external_hls' — the one type the HLS proxy serves, and an
 *     explicit value, so frontend getEffectiveDeliveryType() short-circuits on it instead of
 *     falling back to inferring the type FROM these URLs.
 *   - the proxy is on. With `external_use_proxy = 0` the player streams direct and
 *     resolveStreamUrl() genuinely needs the raw URL.
 * The "Buka Sumber Resmi" link only renders in the fallback for formats the internal player
 * cannot play, which by definition excludes this case.
 */
function shouldHideOriginUrls(camera) {
    const proxied = camera.external_use_proxy === 1 || camera.external_use_proxy === true;
    return camera.stream_source === 'external'
        && camera.delivery_type === 'external_hls'
        && proxied;
}

/*
 * external_mjpeg is the other delivery type whose origin must never ship raw: the stream is an
 * <img src>, so the URL — routinely a ZoneMinder nph-zms URL carrying a ?token= JWT — used to be
 * published verbatim for the browser to fetch direct. The opaque /api/stream/:id/external.mjpeg
 * relay resolves it server-side instead, so the public payload REWRITES (not drops — the <img>
 * still needs a src) external_stream_url to the opaque path. delivery_type may be absent on
 * secondary projections, so resolve it when missing (same inference the frontend runs).
 */
function mjpegOpaquePath(camera) {
    if (camera?.stream_source !== 'external' || !camera?.id) return null;
    const deliveryType = camera.delivery_type || getEffectiveDeliveryType(camera);
    return deliveryType === 'external_mjpeg'
        ? `/api/stream/${camera.id}/external.mjpeg`
        : null;
}

/*
 * ONLY the stream origins. `external_snapshot_url` deliberately does NOT belong here: it is a
 * still image, it never touches the HLS proxy, and the public UI uses it as the PREFERRED
 * thumbnail source — LandingCameraCard, LandingHeroSpotlight and PlaybackCameraPicker all read
 * `external_snapshot_url || thumbnail_path`, and LandingHero gates the whole spotlight on that
 * pair being present. Stripping it cost cameras their picture (and the hero its slot) while
 * buying no protection at all.
 */
export const PROXIED_ORIGIN_URL_FIELDS = [
    'external_stream_url',
    'external_hls_url',
];

/*
 * Every external URL an anonymous client can be handed. Proxied external_hls cameras drop
 * stream/hls entirely (above); the rest — non-proxied streams, and the embed/snapshot URLs that are
 * NEVER dropped because the public UI needs them — still ship raw. An admin who typed credentials
 * into any of these (https://user:pass@host/…) would leak them to the whole internet, so the
 * userinfo is stripped from ALL of them unconditionally, leaving a still-functional URL.
 */
export const CREDENTIALED_EXTERNAL_URL_FIELDS = [
    'external_stream_url',
    'external_hls_url',
    'external_embed_url',
    'external_snapshot_url',
];

/**
 * Shared so /api/cameras/active and /api/public/* cannot drift apart. Closing the leak on
 * one public endpoint while the next one over still publishes the same URL is not hardening,
 * it just moves where you have to look for it.
 *
 * `publicGrowthService` rows carry no `external_use_proxy` column, so pass the default the
 * DB uses (`COALESCE(external_use_proxy, 1)`) rather than letting an absent field read as
 * "not proxied" and keep the URL.
 *
 * @param {object} camera - public camera read model (mutated copy is returned)
 * @param {{ assumeProxied?: boolean }} [options]
 * @returns {object} camera without the origin URLs it must not publish
 */
export function stripProxiedOriginUrls(camera, { assumeProxied = false } = {}) {
    if (!camera || typeof camera !== 'object') {
        return camera;
    }

    // Credential-strip runs for EVERY camera — a non-proxied stream/hls URL and the embed/snapshot
    // URLs (never dropped below) all ship raw, and any of them may carry userinfo. Copy-on-write, so
    // a credential-free row is returned byte-identical.
    let publicCamera = camera;
    for (const field of CREDENTIALED_EXTERNAL_URL_FIELDS) {
        const cleaned = stripUrlCredentials(camera[field]);
        if (cleaned !== camera[field]) {
            if (publicCamera === camera) publicCamera = { ...camera };
            publicCamera[field] = cleaned;
        }
    }

    const subject = assumeProxied && publicCamera.external_use_proxy === undefined
        ? { ...publicCamera, external_use_proxy: 1 }
        : publicCamera;

    // MJPEG rewrite BEFORE the hls-drop branch — an mjpeg camera keeps a playable field, just
    // an opaque one. The token-bearing copy in external_hls_url/external_embed_url (whichever
    // duplicates the nph-zms source) is dropped so the secret has exactly one exit: the relay.
    const opaqueMjpeg = mjpegOpaquePath(publicCamera);
    if (opaqueMjpeg) {
        if (publicCamera === camera) publicCamera = { ...camera };
        publicCamera.external_stream_url = opaqueMjpeg;
        // Emit the resolved type too — a legacy row with delivery_type NULL would otherwise
        // re-infer 'external_hls' from the now-relative path and try to HLS-play an <img>.
        publicCamera.delivery_type = 'external_mjpeg';
        if (DELIVERY_TYPE_PATTERNS.zoneminderMjpeg.test(publicCamera.external_hls_url || '')) {
            delete publicCamera.external_hls_url;
        }
        if (DELIVERY_TYPE_PATTERNS.zoneminderMjpeg.test(publicCamera.external_embed_url || '')) {
            delete publicCamera.external_embed_url;
        }
        return publicCamera;
    }

    if (!shouldHideOriginUrls(subject)) {
        return publicCamera;
    }

    if (publicCamera === camera) publicCamera = { ...camera };
    for (const field of PROXIED_ORIGIN_URL_FIELDS) {
        delete publicCamera[field];
    }
    return publicCamera;
}

export function stripInternalLandingFields(camera) {
    if (!camera || typeof camera !== 'object') {
        return camera;
    }

    const publicCamera = { ...camera };
    for (const field of PUBLIC_LANDING_INTERNAL_FIELDS) {
        delete publicCamera[field];
    }
    return stripProxiedOriginUrls(publicCamera);
}

/*
 * Fields the public landing grid/map/filters actually read (verified against every
 * `camera.*` access under components/landing, CameraContext, hooks/public, the map
 * subtree, and AreaPublicPage). Everything else the row carries — stream URLs, the
 * external_* transport knobs, description/group_name, and the availability detail
 * fields — is playback-detail or backend-internal data the landing list was
 * shipping anyway: ~33 keys per camera, ~1MB raw for a ~1000-camera list.
 *
 * `?summary=1` picks these AFTER the full projection has been built, enriched, and
 * stripped, so the slim read model can never drift from the hardening rules above.
 */
export const PUBLIC_LANDING_SLIM_FIELDS = [
    'id',
    'name',
    'location',
    'area_id',
    'area_name',
    'is_tunnel',
    'latitude',
    'longitude',
    'status',
    'enabled',
    'enable_recording',
    'camera_class',
    'video_codec',
    'thumbnail_path',
    'thumbnail_updated_at',
    'external_snapshot_url',
    'delivery_type',
    'is_online',
    'is_recording',
    'created_at',
    'availability_state',
    'live_viewers',
    'total_views',
    'viewer_stats',
];

export function slimLandingCamera(camera) {
    if (!camera || typeof camera !== 'object') {
        return camera;
    }
    const slim = {};
    for (const field of PUBLIC_LANDING_SLIM_FIELDS) {
        if (field in camera) slim[field] = camera[field];
    }
    return slim;
}

/*
 * Default-grid ordering, replicated server-side for the SSI LCP fragment.
 *
 * The landing grid's first card under the default state (no search, city 'all',
 * area 'all', tab 'all') is decided by `gridAreaScopedCameras` in
 * hooks/public/useLandingCameraFilters.js: cameras belonging to an area flagged
 * `show_on_grid_default` are grouped in first-occurrence order, each group is
 * sorted online-first then name-asc and capped at grid_default_camera_limit, and
 * the scoped heads lead the list. For the SINGLE first pick only the head of the
 * earliest-occurring flagged area matters — overflow and unscoped cameras can
 * never precede it. With no flagged areas (or no cameras inside any), the raw
 * API order (is_tunnel ASC, id ASC) decides.
 *
 * Keep the two implementations in sync — a wrong pick still produces a correct
 * LCP-size image, just for a different camera than the real first card.
 */
export function pickFirstGridCamera(cameras, areas) {
    if (!Array.isArray(cameras) || cameras.length === 0) {
        return null;
    }
    const flagged = new Set();
    for (const area of areas || []) {
        if (area?.name && (area.show_on_grid_default === 1 || area.show_on_grid_default === true)) {
            flagged.add(area.name);
        }
    }
    if (flagged.size === 0) {
        return cameras[0] || null;
    }
    const groups = new Map();
    for (const camera of cameras) {
        if (!camera?.area_name || !flagged.has(camera.area_name)) continue;
        if (!groups.has(camera.area_name)) groups.set(camera.area_name, []);
        groups.get(camera.area_name).push(camera);
    }
    const firstGroup = groups.values().next().value;
    if (!firstGroup) {
        return cameras[0] || null;
    }
    const head = [...firstGroup].sort((left, right) => {
        const leftOnline = left?.is_online === 1 || left?.is_online === true ? 1 : 0;
        const rightOnline = right?.is_online === 1 || right?.is_online === true ? 1 : 0;
        if (leftOnline !== rightOnline) return rightOnline - leftOnline;
        return (left?.name || '').localeCompare(right?.name || '');
    });
    return head[0] || cameras[0] || null;
}

function escapeAttr(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/*
 * HTML fragment for the SSI include in index.html's boot shell: the real <img>
 * markup for the first grid card's thumbnail, baked into the initial bytes so the
 * browser starts the LCP fetch with the document instead of after JSON boot.
 * Empty string when nothing imageable exists — the JS fallback (and nginx's
 * include-error behaviour is to emit nothing harmful) keeps the shell skeleton.
 *
 * URL shape mirrors CameraThumbnail: `external_snapshot_url || thumbnail_path`,
 * with `?v=thumbnail_updated_at` appended only for /api/thumbnails/* paths.
 *
 * `inlineDataUri` trades ~14KB of HTML for a paint GUARANTEE: with the bytes
 * already inside the tag, the thumbnail decodes with the very first frame —
 * under CPU throttling a network-fetched image routinely misses that frame and
 * the next ones are starved by bundle-eval long tasks until React clears #root.
 */
export function buildLcpCardFragment(camera, { inlineDataUri = null } = {}) {
    const thumbPath = camera?.external_snapshot_url || camera?.thumbnail_path;
    if (!thumbPath && !inlineDataUri) {
        return '';
    }
    let url = inlineDataUri || String(thumbPath);
    if (!inlineDataUri && camera.thumbnail_updated_at && url.indexOf('/api/thumbnails/') === 0) {
        url += (url.indexOf('?') >= 0 ? '&' : '?') + 'v=' + encodeURIComponent(camera.thumbnail_updated_at);
    }
    const alt = escapeAttr((camera.name || 'CCTV') + ' preview');
    return `<img id="boot-lcp-img" src="${escapeAttr(url)}" alt="${alt}" fetchpriority="high" decoding="sync" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover" />`;
}

/*
 * Ingest and routing policy. Distinct from the health fields above because it answers a different
 * question — not "is this camera up" but "how does this backend TALK to it": whether the stream is
 * held open or dialled on demand and for how long, which RTSP transport is used, and which source
 * profile applies. None of it is a credential. All of it is a description of how the streaming tier
 * behaves, which is reconnaissance, and it was being handed to anonymous callers for free.
 *
 * `GET /api/stream/` shipped every one of these on every call. That endpoint had been hardened
 * once, carefully — private_rtsp_url and stream_key are destructured off with a comment explaining
 * why — and the fields below simply were not part of that day's question. That is the pattern this
 * whole sweep kept finding: the fix goes into the field someone was thinking about, and the rest of
 * the row rides along.
 *
 * Verified before removing: zero references in non-admin frontend code for any of them.
 */
export const PUBLIC_STREAM_INTERNAL_FIELDS = [
    'source_profile',
    'internal_ingest_policy_override',
    'internal_on_demand_close_after_seconds_override',
    'internal_on_demand_close_after_seconds',
    'area_internal_ingest_policy_default',
    'internal_rtsp_transport_override',
    'area_internal_rtsp_transport_default',
    'last_online_check',
];

/**
 * Public projection for the stream endpoints: everything the landing strip removes, plus the
 * ingest/routing policy above.
 *
 * @param {object} camera enriched camera row
 * @returns {object} shallow copy safe for an unauthenticated response
 */
export function stripInternalStreamFields(camera) {
    const publicCamera = stripInternalLandingFields(camera);
    if (!publicCamera || typeof publicCamera !== 'object') {
        return publicCamera;
    }

    for (const field of PUBLIC_STREAM_INTERNAL_FIELDS) {
        delete publicCamera[field];
    }
    return publicCamera;
}
