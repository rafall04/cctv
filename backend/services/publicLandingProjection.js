/*
 * Purpose: Strip internal health/runtime/policy fields from a public landing camera object
 *          AFTER availability enrichment, so GET /api/cameras/active stays lean and never
 *          leaks internal monitoring/health state to the public surface.
 * Caller: cameraService.getPublicLandingCameraList (final .map in the read-model pipeline).
 * Deps: none.
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

export const PROXIED_ORIGIN_URL_FIELDS = [
    'external_stream_url',
    'external_hls_url',
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

    const subject = assumeProxied && camera.external_use_proxy === undefined
        ? { ...camera, external_use_proxy: 1 }
        : camera;

    if (!shouldHideOriginUrls(subject)) {
        return camera;
    }

    const publicCamera = { ...camera };
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
