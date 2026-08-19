const INTERNAL_INGEST_POLICY_VALUES = new Set(['default', 'always_on', 'on_demand']);
const DEFAULT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS = 30;
const STRICT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS = 15;

export function normalizeInternalIngestPolicy(value) {
    return INTERNAL_INGEST_POLICY_VALUES.has(value) ? value : 'default';
}

export function normalizeOnDemandCloseAfterSeconds(value, fallback = null) {
    if (value === undefined) {
        return fallback;
    }

    if (value === null || value === '') {
        return null;
    }

    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        return fallback;
    }

    return Math.min(Math.max(parsed, 5), 300);
}

export function isStrictOnDemandSourceProfile(camera = {}) {
    if (camera?.source_profile === 'surabaya_private_rtsp') {
        return true;
    }

    const description = String(camera?.description || '').toLowerCase();
    return Boolean(camera?.private_rtsp_url)
        && Number(camera?.enable_recording || 0) === 0
        && (
            description.includes('source: private rtsp live only')
            || description.includes('source_tag: surabaya_private_rtsp')
            || description.includes('surabaya_private_rtsp')
        );
}

export function resolveInternalIngestPolicy(camera = {}, area = null) {
    const cameraMode = normalizeInternalIngestPolicy(camera?.internal_ingest_policy_override);
    const areaMode = normalizeInternalIngestPolicy(area?.internal_ingest_policy_default);
    const strictProfile = isStrictOnDemandSourceProfile(camera);

    let mode = cameraMode !== 'default'
        ? cameraMode
        : (areaMode !== 'default' ? areaMode : 'always_on');

    if (strictProfile && cameraMode === 'default' && areaMode === 'default') {
        mode = 'on_demand';
    }

    const cameraCloseAfter = normalizeOnDemandCloseAfterSeconds(
        camera?.internal_on_demand_close_after_seconds_override,
        null
    );
    const areaCloseAfter = normalizeOnDemandCloseAfterSeconds(
        area?.internal_on_demand_close_after_seconds,
        null
    );

    const closeAfterSeconds = mode === 'always_on'
        ? null
        : (cameraCloseAfter
            ?? areaCloseAfter
            ?? (strictProfile ? STRICT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS : DEFAULT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS));

    return {
        mode,
        closeAfterSeconds,
        isStrictOnDemandProfile: strictProfile && mode === 'on_demand',
        sourceProfile: camera?.source_profile || null,
    };
}

export function buildInternalIngestPolicySummary(camera = {}, area = null) {
    const resolved = resolveInternalIngestPolicy(camera, area);
    return {
        ...resolved,
        cameraPolicyOverride: normalizeInternalIngestPolicy(camera?.internal_ingest_policy_override),
        areaPolicyDefault: normalizeInternalIngestPolicy(area?.internal_ingest_policy_default),
        cameraCloseAfterOverrideSeconds: normalizeOnDemandCloseAfterSeconds(
            camera?.internal_on_demand_close_after_seconds_override,
            null
        ),
        areaCloseAfterDefaultSeconds: normalizeOnDemandCloseAfterSeconds(
            area?.internal_on_demand_close_after_seconds,
            null
        ),
    };
}

export {
    DEFAULT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS,
    STRICT_INTERNAL_ON_DEMAND_CLOSE_AFTER_SECONDS,
};

/*
 * Circuit breaker: stop MediaMTX from hammering a camera that has been dead for a long time.
 *
 * MediaMTX retries a static source on a fixed interval, forever, with no backoff and no knob to
 * change it — by far the largest source of connection churn against a broken camera. On the cheap
 * `RtpRtspFlyer` firmware this deployment runs, that is not merely wasted traffic: every attempt
 * leaves a dead session behind, the session table fills, and a full table answers 401 to correct
 * credentials. The camera then cannot recover while we keep knocking, so the retry that exists to
 * reconnect is precisely what prevents reconnection. Cameras 7 and 8 sat wedged for two days;
 * eight minutes of total silence fixed camera 7 outright.
 *
 * Parking means `sourceOnDemand: true`: MediaMTX stops dialling on its own and only tries when a
 * viewer actually asks. Recovery is still detected, because the health probe reaches the camera
 * directly on its own (cold) cadence — roughly twelve attempts an hour instead of hundreds — and
 * the moment one succeeds the camera reads online again and this returns false.
 *
 * THE THIRD CONDITION IS THE IMPORTANT ONE. Requiring a RECENT health check means a health system
 * that has stopped working cannot park anything: `lastHealthCheckAt` goes stale fleet-wide, every
 * camera fails this test, and nothing is parked. That matters because a frozen sweep is not
 * hypothetical here — one froze for two days on 2026-08-17 and left the whole fleet's verdicts
 * pinned. Without this condition, that outage would have parked every camera at once.
 *
 * Requiring `lastOnlineAt` to exist and be old is the second guard: only a camera that WAS working
 * and then died gets parked. A camera that has never once been seen online is a configuration
 * problem, not a wedge, and is left alone so a newly added camera is never quietly demoted.
 */
export const INGEST_PARK_AFTER_MS = 30 * 60 * 1000;
export const INGEST_PARK_HEALTH_FRESH_MS = 10 * 60 * 1000;

/** `MEDIAMTX_PARK_DEAD_INGEST=off` disables parking entirely, without a deploy. */
export function isIngestParkEnabled() {
    return String(process.env.MEDIAMTX_PARK_DEAD_INGEST || '').trim().toLowerCase() !== 'off';
}

function toMillis(value) {
    if (!value) return null;
    const parsed = value instanceof Date ? value.getTime() : Date.parse(String(value).replace(' ', 'T'));
    return Number.isFinite(parsed) ? parsed : null;
}

export function shouldParkInternalIngest(camera = {}, now = Date.now(), {
    parkAfterMs = INGEST_PARK_AFTER_MS,
    healthFreshMs = INGEST_PARK_HEALTH_FRESH_MS,
} = {}) {
    if (!isIngestParkEnabled()) return false;
    // Explicit about absence: `Number(null)` is 0, so a plain numeric compare would read a camera
    // whose state is simply unknown as confirmed-dead and park it. Unknown must never park.
    const isOnline = camera.is_online;
    if (isOnline === null || isOnline === undefined || Number(isOnline) !== 0) return false;

    const lastOnlineAt = toMillis(camera.last_online_at);
    if (lastOnlineAt === null || (now - lastOnlineAt) < parkAfterMs) return false;

    const lastHealthCheckAt = toMillis(camera.last_health_check_at);
    if (lastHealthCheckAt === null || (now - lastHealthCheckAt) > healthFreshMs) return false;

    return true;
}
