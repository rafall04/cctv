/**
 * Purpose: Maintain lightweight public live-view counters per camera without scanning viewer history on hot paths.
 * Caller: viewerSessionService when live sessions end, streamService when public stream cards are listed.
 * Deps: connectionPool, cacheService.
 * MainFuncs: recordCompletedLiveView, getPublicStatsByCamera.
 * SideEffects: Writes camera_view_stats counters and invalidates short-lived public stats cache.
 */

import { execute, query } from '../database/connectionPool.js';
import {
    cacheGetOrSetSync,
    cacheInvalidate,
    cacheKey,
    CacheNamespace,
    CacheTTL,
} from './cacheService.js';

const PUBLIC_STATS_CACHE_KEY = cacheKey(CacheNamespace.STATS, 'camera_view_stats', 'public');
const PUBLIC_STATS_CACHE_PREFIX = cacheKey(CacheNamespace.STATS, 'camera_view_stats');

const EMPTY_VIEW_STATS = Object.freeze({
    live_viewers: 0,
    total_views: 0,
    total_watch_seconds: 0,
    last_viewed_at: null,
});

function toNonNegativeInteger(value) {
    const numericValue = Number.parseInt(value, 10);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeStatsRow(row) {
    return {
        live_viewers: toNonNegativeInteger(row.live_viewers),
        total_views: toNonNegativeInteger(row.total_views),
        total_watch_seconds: toNonNegativeInteger(row.total_watch_seconds),
        last_viewed_at: row.last_viewed_at || null,
    };
}

class CameraViewStatsService {
    get emptyStats() {
        return { ...EMPTY_VIEW_STATS };
    }

    recordCompletedLiveView({ cameraId, durationSeconds = 0, viewedAt }) {
        const normalizedCameraId = Number.parseInt(cameraId, 10);
        if (!Number.isInteger(normalizedCameraId) || normalizedCameraId <= 0) {
            return false;
        }

        const normalizedDuration = toNonNegativeInteger(durationSeconds);
        const timestamp = viewedAt || new Date().toISOString().slice(0, 19).replace('T', ' ');

        execute(`
            INSERT INTO camera_view_stats (
                camera_id,
                total_live_views,
                total_watch_seconds,
                last_viewed_at,
                created_at,
                updated_at
            )
            VALUES (?, 1, ?, ?, ?, ?)
            ON CONFLICT(camera_id) DO UPDATE SET
                total_live_views = total_live_views + 1,
                total_watch_seconds = total_watch_seconds + excluded.total_watch_seconds,
                last_viewed_at = excluded.last_viewed_at,
                updated_at = excluded.updated_at
        `, [normalizedCameraId, normalizedDuration, timestamp, timestamp, timestamp]);

        cacheInvalidate(PUBLIC_STATS_CACHE_PREFIX);
        return true;
    }

    getPublicStatsByCamera() {
        return cacheGetOrSetSync(PUBLIC_STATS_CACHE_KEY, () => {
            const rows = query(`
                SELECT
                    c.id as camera_id,
                    COALESCE(active.viewer_count, 0) as live_viewers,
                    COALESCE(cvs.total_live_views, 0) as total_views,
                    COALESCE(cvs.total_watch_seconds, 0) as total_watch_seconds,
                    cvs.last_viewed_at
                FROM cameras c
                LEFT JOIN camera_view_stats cvs ON cvs.camera_id = c.id
                LEFT JOIN (
                    SELECT camera_id, COUNT(*) as viewer_count
                    FROM viewer_sessions
                    WHERE is_active = 1
                    GROUP BY camera_id
                ) active ON active.camera_id = c.id
                WHERE c.enabled = 1
            `);

            return rows.reduce((statsByCamera, row) => {
                statsByCamera[row.camera_id] = normalizeStatsRow(row);
                return statsByCamera;
            }, {});
        }, CacheTTL.SHORT);
    }
}

export default new CameraViewStatsService();
