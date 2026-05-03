/*
 * Purpose: Pure helpers for admin area bulk camera policy target selection and payload construction.
 * Caller: AreaManagement page and area bulk policy tests.
 * Deps: None.
 * MainFuncs: defaultBulkConfig, requiresExternalHlsTarget, requiresExternalStreamsTarget, getEffectiveTargetFilter, buildBulkPayload.
 * SideEffects: None.
 */

export const defaultBulkConfig = {
    targetFilter: 'all',
    operation: 'policy_update',
    delivery_type: 'ignore',
    external_health_mode: 'ignore',
    external_use_proxy: 'ignore',
    enable_recording: 'ignore',
    enabled: 'ignore',
    external_tls_mode: 'ignore',
    external_origin_mode: 'ignore',
    video_codec: 'ignore',
    clear_internal_rtsp: false,
};

export function requiresExternalHlsTarget(config) {
    if (config.operation !== 'policy_update' && config.operation !== 'maintenance') {
        return false;
    }

    return config.external_use_proxy !== 'ignore'
        || config.external_tls_mode !== 'ignore'
        || config.external_origin_mode !== 'ignore';
}

export function requiresExternalStreamsTarget(config) {
    if (config.operation !== 'policy_update' && config.operation !== 'maintenance') {
        return false;
    }

    return config.external_health_mode !== 'ignore';
}

export function getEffectiveTargetFilter(config) {
    if (requiresExternalHlsTarget(config)) {
        return 'external_hls_only';
    }
    if (requiresExternalStreamsTarget(config)) {
        return 'external_streams_only';
    }
    return config.targetFilter || 'all';
}

export function buildBulkPayload(config) {
    const payload = {};

    if (config.operation === 'policy_update' || config.operation === 'maintenance') {
        if (config.delivery_type !== 'ignore') payload.delivery_type = config.delivery_type;
        if (config.external_health_mode !== 'ignore') payload.external_health_mode = config.external_health_mode;
        if (config.external_use_proxy !== 'ignore') payload.external_use_proxy = parseInt(config.external_use_proxy, 10);
        if (config.enable_recording !== 'ignore') payload.enable_recording = parseInt(config.enable_recording, 10);
        if (config.enabled !== 'ignore') payload.enabled = parseInt(config.enabled, 10);
        if (config.external_tls_mode !== 'ignore') payload.external_tls_mode = config.external_tls_mode;
        if (config.external_origin_mode !== 'ignore') payload.external_origin_mode = config.external_origin_mode;
        if (config.video_codec !== 'ignore') payload.video_codec = config.video_codec;
    }

    if (config.operation === 'normalization') {
        if (config.delivery_type !== 'ignore') payload.delivery_type = config.delivery_type;
        if (config.clear_internal_rtsp) payload.clear_internal_rtsp = true;
    }

    return payload;
}
