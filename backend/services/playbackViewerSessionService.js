import { query, queryOne, execute } from '../database/connectionPool.js';
import { v4 as uuidv4 } from 'uuid';
import { getTimezone } from './timezoneService.js';

const SESSION_TIMEOUT = 15;
const CLEANUP_INTERVAL = 60000;
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

class PlaybackViewerSessionService {
    constructor() {
        this.cleanupInterval = null;
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

    getStats(filters = {}) {
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
    }

    getAnalytics(period = '7days', filters = {}) {
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
    }
}

export default new PlaybackViewerSessionService();
