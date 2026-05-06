/*
 * Purpose: Define shared sanitized camera SELECT projections for public stream read models.
 * Caller: Backend streamService public stream endpoints.
 * Deps: cameras and areas table schemas.
 * MainFuncs: SHARED_CAMERA_STREAM_PROJECTION, SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION.
 * SideEffects: None; SQL projection constants only.
 */

export const SHARED_CAMERA_STREAM_PROJECTION = `
    c.id,
    c.name,
    c.description,
    c.location,
    c.group_name,
    c.area_id,
    c.is_tunnel,
    c.latitude,
    c.longitude,
    c.status,
    c.is_online,
    c.last_online_check,
    c.enabled,
    c.enable_recording,
    CASE
        WHEN c.internal_ingest_policy_override IN ('default', 'always_on', 'on_demand') THEN c.internal_ingest_policy_override
        ELSE 'default'
    END as internal_ingest_policy_override,
    c.internal_on_demand_close_after_seconds_override,
    c.source_profile,
    c.stream_key,
    c.video_codec,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.stream_source,
    c.external_hls_url,
    c.delivery_type,
    c.external_stream_url,
    c.external_embed_url,
    c.external_snapshot_url,
    CASE
        WHEN c.external_origin_mode IN ('direct', 'embed') THEN c.external_origin_mode
        ELSE 'direct'
    END as external_origin_mode,
    COALESCE(c.external_use_proxy, 1) as external_use_proxy,
    CASE
        WHEN c.external_tls_mode IN ('strict', 'insecure') THEN c.external_tls_mode
        ELSE 'strict'
    END as external_tls_mode,
    CASE
        WHEN c.external_health_mode IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled') THEN c.external_health_mode
        ELSE 'default'
    END as external_health_mode,
    CASE
        WHEN c.public_playback_mode IN ('inherit', 'disabled', 'preview_only', 'admin_only') THEN c.public_playback_mode
        ELSE 'inherit'
    END as public_playback_mode,
    c.public_playback_preview_minutes
`;

export const SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION = `
    ${SHARED_CAMERA_STREAM_PROJECTION},
    a.name as area_name,
    a.rt,
    a.rw,
    a.kelurahan,
    a.kecamatan,
    CASE
        WHEN a.internal_ingest_policy_default IN ('default', 'always_on', 'on_demand')
            THEN a.internal_ingest_policy_default
        ELSE 'default'
    END as area_internal_ingest_policy_default,
    a.internal_on_demand_close_after_seconds,
    CASE
        WHEN a.external_health_mode_override IN ('default', 'passive_first', 'hybrid_probe', 'probe_first', 'disabled')
            THEN a.external_health_mode_override
        ELSE 'default'
    END as area_external_health_mode_override
`;
