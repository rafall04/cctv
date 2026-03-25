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
    c.stream_key,
    c.private_rtsp_url,
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
    END as external_tls_mode
`;

export const SHARED_CAMERA_STREAM_WITH_AREA_PROJECTION = `
    ${SHARED_CAMERA_STREAM_PROJECTION},
    a.name as area_name,
    a.rt,
    a.rw,
    a.kelurahan,
    a.kecamatan
`;
