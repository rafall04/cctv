/**
 * Purpose: Build sanitized public growth read models for area pages and trending CCTV.
 * Caller: publicGrowthController and public growth route tests.
 * Deps: database connection helpers.
 * MainFuncs: getPublicAreaBySlug, getPublicAreaCameras, getTrendingCameras.
 * SideEffects: Reads public camera, area, runtime, and compact view stats data.
 */

import { query, queryOne } from '../database/connectionPool.js';

const PUBLIC_CAMERA_COLUMNS = `
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
    c.enabled,
    c.enable_recording,
    c.video_codec,
    c.stream_key,
    c.thumbnail_path,
    c.thumbnail_updated_at,
    c.stream_source,
    c.external_hls_url,
    c.delivery_type,
    c.external_stream_url,
    c.external_embed_url,
    c.external_snapshot_url,
    a.name AS area_name,
    LOWER(REPLACE(a.name, ' ', '-')) AS area_slug,
    COALESCE(cvs.total_live_views, 0) AS total_views,
    COALESCE(active.viewer_count, 0) AS live_viewers
`;

function normalizeLimit(limit) {
    const parsed = Number.parseInt(limit, 10);
    if (Number.isNaN(parsed)) {
        return 10;
    }
    return Math.min(Math.max(parsed, 1), 20);
}

function toAreaSlug(name = '') {
    return String(name).trim().toLowerCase().replace(/\s+/g, '-');
}

function assertArea(row, slug) {
    if (!row) {
        const error = new Error(`Area ${slug} tidak ditemukan`);
        error.statusCode = 404;
        throw error;
    }
}

function sanitizeCamera(row) {
    const liveViewers = Number(row.live_viewers || 0);
    const totalViews = Number(row.total_views || 0);

    return {
        id: row.id,
        name: row.name,
        description: row.description,
        location: row.location,
        group_name: row.group_name,
        area_id: row.area_id,
        is_tunnel: row.is_tunnel,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        enabled: row.enabled,
        enable_recording: row.enable_recording,
        video_codec: row.video_codec,
        stream_key: row.stream_key,
        thumbnail_path: row.thumbnail_path,
        thumbnail_updated_at: row.thumbnail_updated_at,
        stream_source: row.stream_source,
        external_hls_url: row.external_hls_url,
        delivery_type: row.delivery_type,
        external_stream_url: row.external_stream_url,
        external_embed_url: row.external_embed_url,
        external_snapshot_url: row.external_snapshot_url,
        area_name: row.area_name,
        area_slug: row.area_slug || toAreaSlug(row.area_name),
        total_views: totalViews,
        live_viewers: liveViewers,
        viewer_stats: {
            live_viewers: liveViewers,
            total_views: totalViews,
        },
    };
}

function getActiveViewerJoin() {
    return `
        LEFT JOIN (
            SELECT camera_id, COUNT(*) AS viewer_count
            FROM viewer_sessions
            WHERE is_active = 1
            GROUP BY camera_id
        ) active ON active.camera_id = c.id
    `;
}

export function getPublicAreaBySlug(areaSlug) {
    const row = queryOne(`
        SELECT
            a.id,
            a.name,
            LOWER(REPLACE(a.name, ' ', '-')) AS slug,
            COUNT(c.id) AS camera_count,
            SUM(CASE WHEN c.status = 'online' THEN 1 ELSE 0 END) AS online_count,
            COALESCE(SUM(cvs.total_live_views), 0) AS total_views
        FROM areas a
        LEFT JOIN cameras c ON c.area_id = a.id AND c.enabled = 1
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        WHERE LOWER(REPLACE(a.name, ' ', '-')) = ?
        GROUP BY a.id
    `, [areaSlug]);

    assertArea(row, areaSlug);

    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        camera_count: Number(row.camera_count || 0),
        online_count: Number(row.online_count || 0),
        total_views: Number(row.total_views || 0),
        description: `Pantau CCTV publik area ${row.name} secara online melalui RAF NET.`,
    };
}

export function getPublicAreaCameras(areaSlug) {
    const area = queryOne(`
        SELECT id, name, LOWER(REPLACE(name, ' ', '-')) AS slug
        FROM areas
        WHERE LOWER(REPLACE(name, ' ', '-')) = ?
    `, [areaSlug]);
    assertArea(area, areaSlug);

    return query(`
        SELECT ${PUBLIC_CAMERA_COLUMNS}
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        ${getActiveViewerJoin()}
        WHERE c.enabled = 1
          AND LOWER(REPLACE(a.name, ' ', '-')) = ?
        ORDER BY c.is_tunnel ASC, c.id ASC
    `, [areaSlug]).map(sanitizeCamera);
}

export function getTrendingCameras({ areaSlug = '', limit = 10 } = {}) {
    const normalizedLimit = normalizeLimit(limit);
    const params = areaSlug ? [areaSlug, normalizedLimit] : [normalizedLimit];
    const areaFilter = areaSlug ? "AND LOWER(REPLACE(a.name, ' ', '-')) = ?" : '';

    return query(`
        SELECT ${PUBLIC_CAMERA_COLUMNS}
        FROM cameras c
        LEFT JOIN areas a ON a.id = c.area_id
        LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
        ${getActiveViewerJoin()}
        WHERE c.enabled = 1
          ${areaFilter}
        ORDER BY COALESCE(cvs.total_live_views, 0) DESC, c.name COLLATE NOCASE ASC, c.id ASC
        LIMIT ?
    `, params).map(sanitizeCamera);
}
