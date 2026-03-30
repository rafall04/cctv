import { query, queryOne, execute } from '../database/connectionPool.js';
import { v4 as uuidv4 } from 'uuid';
import { getTimezone } from './timezoneService.js';
import { cacheGetOrSetSync, cacheKey, CacheNamespace, CacheTTL } from './cacheService.js';

const SESSION_TIMEOUT = 15;
const CLEANUP_INTERVAL = 60000;
const HISTORY_RETENTION_DAYS = 90;
const RETENTION_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PLAYBACK_ACCESS_MODES = new Set(['public_preview', 'admin_full']);

function getTimestamp() {
    const timezone = getTimezone();
    return new Date().toLocaleString('sv-SE', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    }).replace(' ', ' ');
}

function getDate() {
    const timezone = getTimezone();
    return new Date().toLocaleDateString('sv-SE', { timeZone: timezone });
}

function getDateWithOffset(days) {
    const timezone = getTimezone();
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString('sv-SE', { timeZone: timezone });
}

function normalizeAccessMode(value) {
    return PLAYBACK_ACCESS_MODES.has(value) ? value : 'public_preview';
}

function buildHistoryDateFilter(period) {
    const todayDate = getDate();

    if (period?.startsWith('date:')) {
        const customDate = period.substring(5);
        if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
            return {
                clause: 'AND date(started_at) = ?',
                params: [customDate],
            };
        }
    }

    switch (period) {
        case 'today':
            return { clause: 'AND date(started_at) = ?', params: [todayDate] };
        case 'yesterday':
            return { clause: 'AND date(started_at) = ?', params: [getDateWithOffset(-1)] };
        case '7days':
            return { clause: 'AND date(started_at) >= ?', params: [getDateWithOffset(-7)] };
        case '30days':
            return { clause: 'AND date(started_at) >= ?', params: [getDateWithOffset(-30)] };
        default:
            return { clause: '', params: [] };
    }
}

function buildSessionFilters({ cameraId = null, accessMode = '' } = {}, tableAlias = '') {
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const clauses = [];
    const params = [];

    const normalizedCameraId = Number.parseInt(cameraId, 10);
    if (Number.isInteger(normalizedCameraId) && normalizedCameraId > 0) {
        clauses.push(`AND ${prefix}camera_id = ?`);
        params.push(normalizedCameraId);
    }

    if (typeof accessMode === 'string' && PLAYBACK_ACCESS_MODES.has(accessMode)) {
        clauses.push(`AND ${prefix}playback_access_mode = ?`);
        params.push(accessMode);
    }

    return {
        clause: clauses.join(' '),
        params,
    };
}

function buildHistoryFilters({
    cameraId = null,
    accessMode = '',
    deviceType = '',
    search = '',
} = {}) {
    const base = buildSessionFilters({ cameraId, accessMode });
    const clauses = [base.clause];
    const params = [...base.params];

    if (typeof deviceType === 'string' && ['desktop', 'mobile', 'tablet', 'unknown'].includes(deviceType)) {
        clauses.push('AND device_type = ?');
        params.push(deviceType);
    }

    if (typeof search === 'string' && search.trim()) {
        const likeValue = `%${search.trim()}%`;
        clauses.push('AND (camera_name LIKE ? OR segment_filename LIKE ? OR ip_address LIKE ? OR COALESCE(admin_username, \'\') LIKE ?)');
        params.push(likeValue, likeValue, likeValue, likeValue);
    }

    return {
        clause: clauses.filter(Boolean).join(' '),
        params,
    };
}

function resolveHistorySort(sortBy = 'started_at', sortDirection = 'desc') {
    const sortMap = {
        camera_name: 'camera_name',
        segment_filename: 'segment_filename',
        playback_access_mode: 'playback_access_mode',
        ip_address: 'ip_address',
        admin_username: 'admin_username',
        device_type: 'device_type',
        started_at: 'started_at',
        ended_at: 'ended_at',
        duration_seconds: 'duration_seconds',
    };
    const column = sortMap[sortBy] || 'started_at';
    const direction = String(sortDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    return `${column} ${direction}`;
}

class PlaybackViewerSessionService {
    constructor() {
        this.cleanupInterval = null;
        this.lastRetentionRunAt = 0;
    }

    startCleanup() {
        if (this.cleanupInterval) {
            return;
        }

        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleSessions();
        }, CLEANUP_INTERVAL);
        console.log('[PlaybackViewerSession] Cleanup service started');
    }

    stopCleanup() {
        if (!this.cleanupInterval) {
            return;
        }

        clearInterval(this.cleanupInterval);
        this.cleanupInterval = null;
        console.log('[PlaybackViewerSession] Cleanup service stopped');
    }

    getRealIP(request) {
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedFor) {
            return forwardedFor.split(',')[0].trim();
        }

        const realIP = request.headers['x-real-ip'];
        if (realIP) {
            return realIP.trim();
        }

        return request.ip || request.socket?.remoteAddress || 'unknown';
    }

    getDeviceType(userAgent) {
        if (!userAgent) return 'unknown';
        const ua = userAgent.toLowerCase();
        if (ua.includes('mobile') || ua.includes('android') || ua.includes('iphone')) {
            return 'mobile';
        }
        if (ua.includes('tablet') || ua.includes('ipad')) {
            return 'tablet';
        }
        return 'desktop';
    }

    startSession(payload, request) {
        const sessionId = uuidv4();
        const timestamp = getTimestamp();
        const ipAddress = this.getRealIP(request);
        const userAgent = request.headers['user-agent'] || '';
        const deviceType = this.getDeviceType(userAgent);
        const playbackAccessMode = normalizeAccessMode(payload.accessMode);

        execute(`
            INSERT INTO playback_viewer_sessions (
                session_id,
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                user_agent,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                last_heartbeat
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            sessionId,
            payload.cameraId,
            payload.cameraName || `Camera ${payload.cameraId}`,
            payload.segmentFilename,
            payload.segmentStartedAt || null,
            playbackAccessMode,
            ipAddress,
            userAgent,
            deviceType,
            payload.adminUserId || null,
            payload.adminUsername || null,
            timestamp,
            timestamp,
        ]);

        return sessionId;
    }

    heartbeat(sessionId) {
        const timestamp = getTimestamp();
        const result = execute(`
            UPDATE playback_viewer_sessions
            SET last_heartbeat = ?
            WHERE session_id = ? AND is_active = 1
        `, [timestamp, sessionId]);
        return result.changes > 0;
    }

    endSession(sessionId) {
        const session = queryOne(`
            SELECT *
            FROM playback_viewer_sessions
            WHERE session_id = ? AND is_active = 1
        `, [sessionId]);

        if (!session) {
            return false;
        }

        const startedAt = new Date(session.started_at);
        const endedAt = new Date();
        const durationSeconds = Math.max(0, Math.floor((endedAt - startedAt) / 1000));
        const timestamp = getTimestamp();

        execute(`
            UPDATE playback_viewer_sessions
            SET is_active = 0, ended_at = ?, duration_seconds = ?
            WHERE session_id = ?
        `, [timestamp, durationSeconds, sessionId]);

        execute(`
            INSERT INTO playback_viewer_session_history (
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                user_agent,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                ended_at,
                duration_seconds
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            session.camera_id,
            session.camera_name,
            session.segment_filename,
            session.segment_started_at,
            session.playback_access_mode,
            session.ip_address,
            session.user_agent,
            session.device_type,
            session.admin_user_id,
            session.admin_username,
            session.started_at,
            timestamp,
            durationSeconds,
        ]);

        return true;
    }

    cleanupStaleSessions() {
        const timestamp = getTimestamp();
        const staleSessions = query(`
            SELECT session_id
            FROM playback_viewer_sessions
            WHERE is_active = 1
            AND datetime(last_heartbeat) < datetime(?, '-${SESSION_TIMEOUT} seconds')
        `, [timestamp]);

        for (const session of staleSessions) {
            this.endSession(session.session_id);
        }

        this.runRetentionIfDue();
    }

    runRetentionIfDue() {
        const now = Date.now();
        if (now - this.lastRetentionRunAt < RETENTION_RUN_INTERVAL_MS) {
            return;
        }

        this.lastRetentionRunAt = now;
        this.archiveOldHistory();
    }

    archiveOldHistory(retentionDays = HISTORY_RETENTION_DAYS) {
        try {
            execute(`
                INSERT INTO playback_viewer_session_history_archive (
                    id,
                    camera_id,
                    camera_name,
                    segment_filename,
                    segment_started_at,
                    playback_access_mode,
                    ip_address,
                    user_agent,
                    device_type,
                    admin_user_id,
                    admin_username,
                    started_at,
                    ended_at,
                    duration_seconds,
                    created_at,
                    archived_at
                )
                SELECT
                    id,
                    camera_id,
                    camera_name,
                    segment_filename,
                    segment_started_at,
                    playback_access_mode,
                    ip_address,
                    user_agent,
                    device_type,
                    admin_user_id,
                    admin_username,
                    started_at,
                    ended_at,
                    duration_seconds,
                    created_at,
                    CURRENT_TIMESTAMP
                FROM playback_viewer_session_history
                WHERE datetime(started_at) < datetime('now', ?)
                AND NOT EXISTS (
                    SELECT 1
                    FROM playback_viewer_session_history_archive archive
                    WHERE archive.id = playback_viewer_session_history.id
                )
            `, [`-${retentionDays} days`]);

            execute(`
                DELETE FROM playback_viewer_session_history
                WHERE datetime(started_at) < datetime('now', ?)
            `, [`-${retentionDays} days`]);
        } catch (error) {
            if (!String(error?.message || '').includes('no such table')) {
                console.error('[PlaybackViewerSession] Error archiving history:', error);
            }
        }
    }

    getActiveSessions(filters = {}) {
        const { clause, params } = buildSessionFilters(filters);
        const timestamp = getTimestamp();

        return query(`
            SELECT
                session_id,
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                last_heartbeat,
                CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER) as duration_seconds
            FROM playback_viewer_sessions
            WHERE is_active = 1
            ${clause}
            ORDER BY started_at DESC
        `, [timestamp, ...params]);
    }

    getSessionHistory(limit = 50, offset = 0, filters = {}) {
        const { clause, params } = buildSessionFilters(filters);
        return query(`
            SELECT
                id,
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                ended_at,
                duration_seconds
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${clause}
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);
    }

    getHistoryPage({
        period = '7days',
        page = 1,
        pageSize = 25,
        cameraId = null,
        accessMode = '',
        deviceType = '',
        search = '',
        sortBy = 'started_at',
        sortDirection = 'desc',
    } = {}) {
        const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 25));
        const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
        const offset = (safePage - 1) * safePageSize;
        const dateFilter = buildHistoryDateFilter(period);
        const filters = buildHistoryFilters({ cameraId, accessMode, deviceType, search });
        const whereClause = `${dateFilter.clause} ${filters.clause}`.trim();
        const params = [...dateFilter.params, ...filters.params];
        const orderBy = resolveHistorySort(sortBy, sortDirection);

        const totalResult = queryOne(`
            SELECT COUNT(*) as total_items
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${whereClause}
        `, params);

        const summary = queryOne(`
            SELECT
                COUNT(*) as total_items,
                COUNT(DISTINCT ip_address) as unique_viewers,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${whereClause}
        `, params);

        const items = query(`
            SELECT
                id,
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                user_agent,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                ended_at,
                duration_seconds
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `, [...params, safePageSize, offset]);

        const totalItems = totalResult?.total_items || 0;

        return {
            items,
            pagination: {
                page: safePage,
                pageSize: safePageSize,
                totalItems,
                totalPages: Math.max(1, Math.ceil(totalItems / safePageSize)),
            },
            summary: {
                totalItems: summary?.total_items || 0,
                uniqueViewers: summary?.unique_viewers || 0,
                totalWatchTime: summary?.total_watch_time || 0,
            },
        };
    }

    getStats(filters = {}) {
        const statsKey = cacheKey(
            CacheNamespace.STATS,
            'playback-viewer-stats',
            filters.cameraId || 'all',
            filters.accessMode || 'all'
        );

        return cacheGetOrSetSync(statsKey, () => {
            const { clause, params } = buildSessionFilters(filters);
            const activeResult = queryOne(`
                SELECT COUNT(*) as count
                FROM playback_viewer_sessions
                WHERE is_active = 1
                ${clause}
            `, params);

            const historyResult = queryOne(`
                SELECT
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    COALESCE(AVG(duration_seconds), 0) as avg_session_duration
                FROM playback_viewer_session_history
                WHERE 1 = 1
                ${clause}
            `, params);

            const accessBreakdown = query(`
                SELECT playback_access_mode, COUNT(*) as count
                FROM playback_viewer_session_history
                WHERE 1 = 1
                ${clause}
                GROUP BY playback_access_mode
                ORDER BY count DESC
            `, params);

            return {
                activeViewers: activeResult?.count || 0,
                totalSessions: historyResult?.total_sessions || 0,
                uniqueViewers: historyResult?.unique_viewers || 0,
                totalWatchTime: historyResult?.total_watch_time || 0,
                avgSessionDuration: Math.round(historyResult?.avg_session_duration || 0),
                accessBreakdown,
            };
        }, CacheTTL.SHORT);
    }

    getAnalytics(period = '7days', filters = {}) {
        const analyticsKey = cacheKey(
            CacheNamespace.STATS,
            'playback-viewer-analytics',
            period,
            filters.cameraId || 'all',
            filters.accessMode || 'all'
        );

        return cacheGetOrSetSync(analyticsKey, () => {
            const dateFilter = buildHistoryDateFilter(period);
            const historyFilters = buildSessionFilters(filters);
            const activeSessions = this.getActiveSessions(filters);
            const stats = this.getStats(filters);
            const sharedParams = [...dateFilter.params, ...historyFilters.params];

            const topCameras = query(`
            SELECT
                camera_id,
                camera_name,
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            GROUP BY camera_id, camera_name
            ORDER BY total_sessions DESC
            LIMIT 10
            `, sharedParams);

            const topSegments = query(`
            SELECT
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_viewers,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            GROUP BY camera_id, camera_name, segment_filename, segment_started_at, playback_access_mode
            ORDER BY total_sessions DESC
            LIMIT 15
            `, sharedParams);

            const recentSessions = query(`
            SELECT
                id,
                camera_id,
                camera_name,
                segment_filename,
                segment_started_at,
                playback_access_mode,
                ip_address,
                device_type,
                admin_user_id,
                admin_username,
                started_at,
                ended_at,
                duration_seconds
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            ORDER BY started_at DESC
            LIMIT 50
            `, sharedParams);

            const accessBreakdown = query(`
            SELECT playback_access_mode, COUNT(*) as count
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            GROUP BY playback_access_mode
            ORDER BY count DESC
            `, sharedParams);

            const deviceBreakdown = query(`
            SELECT
                device_type,
                COUNT(*) as count,
                ROUND(COUNT(*) * 100.0 / NULLIF((SELECT COUNT(*) FROM playback_viewer_session_history WHERE 1 = 1 ${dateFilter.clause} ${historyFilters.clause}), 0), 1) as percentage
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            GROUP BY device_type
            ORDER BY count DESC
            `, [...sharedParams, ...sharedParams]);

            const topViewers = query(`
            SELECT
                ip_address,
                COUNT(*) as total_sessions,
                COUNT(DISTINCT camera_id) as cameras_watched,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                MAX(started_at) as last_visit
            FROM playback_viewer_session_history
            WHERE 1 = 1
            ${dateFilter.clause}
            ${historyFilters.clause}
            GROUP BY ip_address
            ORDER BY total_sessions DESC
            LIMIT 20
            `, sharedParams);

            return {
                period,
                overview: {
                    activeViewers: activeSessions.length,
                    totalSessions: stats.totalSessions,
                    uniqueViewers: stats.uniqueViewers,
                    totalWatchTime: stats.totalWatchTime,
                    avgSessionDuration: stats.avgSessionDuration,
                },
                accessBreakdown,
                deviceBreakdown,
                topViewers,
                topCameras,
                topSegments,
                recentSessions,
                activeSessions: activeSessions.map((session) => ({
                sessionId: session.session_id,
                cameraId: session.camera_id,
                cameraName: session.camera_name,
                segmentFilename: session.segment_filename,
                segmentStartedAt: session.segment_started_at,
                playbackAccessMode: session.playback_access_mode,
                ipAddress: session.ip_address,
                deviceType: session.device_type,
                adminUserId: session.admin_user_id,
                adminUsername: session.admin_username,
                startedAt: session.started_at,
                durationSeconds: session.duration_seconds,
                })),
            };
        }, CacheTTL.SHORT);
    }
}

export default new PlaybackViewerSessionService();
