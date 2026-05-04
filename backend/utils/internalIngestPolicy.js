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
