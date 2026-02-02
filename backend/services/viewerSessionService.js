/**
 * Viewer Session Service
 * Manages real-time viewer tracking for CCTV streams
 * 
 * Features:
 * - Track active viewers per camera
 * - Store session history for analytics
 * - Auto-cleanup stale sessions (no heartbeat for 15s)
 * - Get real IP from proxy headers
 * 
 * Timing Configuration:
 * - Frontend heartbeat: every 5 seconds
 * - Backend session timeout: 15 seconds (no heartbeat)
 * - Backend cleanup interval: every 5 seconds
 * - Max staleness: ~20 seconds (15s timeout + 5s cleanup)
 * 
 * Timezone: All timestamps use configured timezone from system settings
 */

import { query, queryOne, execute } from '../database/database.js';
import { v4 as uuidv4 } from 'uuid';
import { getTimezone } from './timezoneService.js';

/**
 * Get current timestamp in configured timezone format for SQLite
 * Format: YYYY-MM-DD HH:MM:SS
 */
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
        hour12: false
    }).replace(' ', ' ');
}

/**
 * Get current date in configured timezone for date comparisons
 * Format: YYYY-MM-DD
 */
function getDate() {
    const timezone = getTimezone();
    return new Date().toLocaleDateString('sv-SE', { 
        timeZone: timezone
    });
}

/**
 * Get date with offset (e.g., -7 days) in configured timezone
 * Format: YYYY-MM-DD
 */
function getDateWithOffset(days) {
    const timezone = getTimezone();
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString('sv-SE', { 
        timeZone: timezone
    });
}

// Session timeout in seconds (if no heartbeat received)
const SESSION_TIMEOUT = 15;

// Cleanup interval in milliseconds
const CLEANUP_INTERVAL = 5000;

class ViewerSessionService {
    constructor() {
        this.cleanupInterval = null;
    }

    startCleanup() {
        if (this.cleanupInterval) return;
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleSessions();
        }, CLEANUP_INTERVAL);
        console.log('[ViewerSession] Cleanup service started');
    }

    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('[ViewerSession] Cleanup service stopped');
        }
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

    startSession(cameraId, request) {
        const sessionId = uuidv4();
        const ipAddress = this.getRealIP(request);
        const userAgent = request.headers['user-agent'] || '';
        const deviceType = this.getDeviceType(userAgent);
        const timestamp = getTimestamp();

        try {
            execute(`
                INSERT INTO viewer_sessions (session_id, camera_id, ip_address, user_agent, device_type, started_at, last_heartbeat)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [sessionId, cameraId, ipAddress, userAgent, deviceType, timestamp, timestamp]);

            console.log(`[ViewerSession] Started: ${sessionId} for camera ${cameraId} from ${ipAddress} at ${timestamp}`);
            return sessionId;
        } catch (error) {
            console.error('[ViewerSession] Error starting session:', error);
            throw error;
        }
    }

    heartbeat(sessionId) {
        try {
            const timestamp = getTimestamp();
            const result = execute(`
                UPDATE viewer_sessions 
                SET last_heartbeat = ?
                WHERE session_id = ? AND is_active = 1
            `, [timestamp, sessionId]);
            return result.changes > 0;
        } catch (error) {
            console.error('[ViewerSession] Error updating heartbeat:', error);
            return false;
        }
    }

    endSession(sessionId) {
        try {
            const session = queryOne(`
                SELECT * FROM viewer_sessions WHERE session_id = ? AND is_active = 1
            `, [sessionId]);

            if (!session) return false;

            const startedAt = new Date(session.started_at);
            const endedAt = new Date();
            const durationSeconds = Math.floor((endedAt - startedAt) / 1000);
            const timestamp = getTimestamp();

            execute(`
                UPDATE viewer_sessions 
                SET is_active = 0, ended_at = ?, duration_seconds = ?
                WHERE session_id = ?
            `, [timestamp, durationSeconds, sessionId]);

            const camera = queryOne('SELECT name FROM cameras WHERE id = ?', [session.camera_id]);

            execute(`
                INSERT INTO viewer_session_history 
                (camera_id, camera_name, ip_address, user_agent, device_type, started_at, ended_at, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                session.camera_id,
                camera?.name || `Camera ${session.camera_id}`,
                session.ip_address,
                session.user_agent,
                session.device_type,
                session.started_at,
                timestamp,
                durationSeconds
            ]);

            console.log(`[ViewerSession] Ended: ${sessionId} (duration: ${durationSeconds}s)`);
            return true;
        } catch (error) {
            console.error('[ViewerSession] Error ending session:', error);
            return false;
        }
    }

    cleanupStaleSessions() {
        try {
            const timestamp = getTimestamp();
            const staleSessions = query(`
                SELECT session_id FROM viewer_sessions 
                WHERE is_active = 1 
                AND datetime(last_heartbeat) < datetime(?, '-${SESSION_TIMEOUT} seconds')
            `, [timestamp]);

            for (const session of staleSessions) {
                this.endSession(session.session_id);
            }

            if (staleSessions.length > 0) {
                console.log(`[ViewerSession] Cleaned up ${staleSessions.length} stale sessions`);
            }
        } catch (error) {
            console.error('[ViewerSession] Error cleaning up sessions:', error);
        }
    }

    getActiveSessions() {
        try {
            const timestamp = getTimestamp();
            return query(`
                SELECT 
                    vs.session_id,
                    vs.camera_id,
                    c.name as camera_name,
                    vs.ip_address,
                    vs.device_type,
                    vs.started_at,
                    vs.last_heartbeat,
                    CAST((julianday(?) - julianday(vs.started_at)) * 86400 AS INTEGER) as duration_seconds
                FROM viewer_sessions vs
                LEFT JOIN cameras c ON vs.camera_id = c.id
                WHERE vs.is_active = 1
                ORDER BY vs.started_at DESC
            `, [timestamp]);
        } catch (error) {
            console.error('[ViewerSession] Error getting active sessions:', error);
            return [];
        }
    }

    getActiveSessionsByCamera(cameraId) {
        try {
            const timestamp = getTimestamp();
            return query(`
                SELECT 
                    session_id,
                    ip_address,
                    device_type,
                    started_at,
                    last_heartbeat,
                    CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER) as duration_seconds
                FROM viewer_sessions
                WHERE camera_id = ? AND is_active = 1
                ORDER BY started_at DESC
            `, [timestamp, cameraId]);
        } catch (error) {
            console.error('[ViewerSession] Error getting camera sessions:', error);
            return [];
        }
    }

    getViewerCountByCamera() {
        try {
            return query(`
                SELECT camera_id, COUNT(*) as viewer_count
                FROM viewer_sessions
                WHERE is_active = 1
                GROUP BY camera_id
            `);
        } catch (error) {
            console.error('[ViewerSession] Error getting viewer counts:', error);
            return [];
        }
    }

    getTotalActiveViewers() {
        try {
            const result = queryOne(`SELECT COUNT(*) as count FROM viewer_sessions WHERE is_active = 1`);
            return result?.count || 0;
        } catch (error) {
            console.error('[ViewerSession] Error getting total viewers:', error);
            return 0;
        }
    }

    getSessionHistory(limit = 50, offset = 0, cameraId = null) {
        try {
            let sql = `
                SELECT * FROM viewer_session_history
                ${cameraId ? 'WHERE camera_id = ?' : ''}
                ORDER BY started_at DESC
                LIMIT ? OFFSET ?
            `;
            const params = cameraId ? [cameraId, limit, offset] : [limit, offset];
            return query(sql, params);
        } catch (error) {
            console.error('[ViewerSession] Error getting history:', error);
            return [];
        }
    }

    getViewerStats() {
        try {
            const activeViewers = this.getTotalActiveViewers();
            const activeSessions = this.getActiveSessions();
            const viewersByCamera = this.getViewerCountByCamera();
            const todayDate = getDate();

            const todayStats = queryOne(`
                SELECT 
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COUNT(*) as total_sessions,
                    SUM(duration_seconds) as total_watch_time
                FROM viewer_session_history
                WHERE date(started_at) = ?
            `, [todayDate]);

            return {
                activeViewers,
                activeSessions,
                viewersByCamera,
                today: {
                    uniqueViewers: todayStats?.unique_viewers || 0,
                    totalSessions: todayStats?.total_sessions || 0,
                    totalWatchTime: todayStats?.total_watch_time || 0
                }
            };
        } catch (error) {
            console.error('[ViewerSession] Error getting stats:', error);
            return {
                activeViewers: 0,
                activeSessions: [],
                viewersByCamera: [],
                today: { uniqueViewers: 0, totalSessions: 0, totalWatchTime: 0 }
            };
        }
    }


    /**
     * Get comprehensive analytics data for dashboard
     * @param {string} period - 'today', 'yesterday', '7days', '30days', 'all', or 'date:YYYY-MM-DD'
     * Uses WIB timezone for date filtering
     */
    getAnalytics(period = '7days') {
        try {
            // Determine date filter using configured timezone dates
            let dateFilter = '';
            let previousDateFilter = '';
            let periodDays = 0;
            const todayDate = getDate();
            
            // Handle custom date format: "date:YYYY-MM-DD"
            if (period.startsWith('date:')) {
                const customDate = period.substring(5);
                // Validate date format
                if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
                    dateFilter = `AND date(started_at) = '${customDate}'`;
                    // Previous period: day before custom date
                    const prevDate = new Date(customDate);
                    prevDate.setDate(prevDate.getDate() - 1);
                    const prevDateStr = prevDate.toISOString().split('T')[0];
                    previousDateFilter = `AND date(started_at) = '${prevDateStr}'`;
                    periodDays = 1;
                } else {
                    dateFilter = `AND date(started_at) >= '${getWIBDateWithOffset(-7)}'`;
                    previousDateFilter = `AND date(started_at) >= '${getWIBDateWithOffset(-14)}' AND date(started_at) < '${getWIBDateWithOffset(-7)}'`;
                    periodDays = 7;
                }
            } else {
                switch (period) {
                    case 'today':
                        dateFilter = `AND date(started_at) = '${todayDate}'`;
                        previousDateFilter = `AND date(started_at) = '${getDateWithOffset(-1)}'`;
                        periodDays = 1;
                        break;
                    case 'yesterday':
                        dateFilter = `AND date(started_at) = '${getDateWithOffset(-1)}'`;
                        previousDateFilter = `AND date(started_at) = '${getDateWithOffset(-2)}'`;
                        periodDays = 1;
                        break;
                    case '7days':
                        dateFilter = `AND date(started_at) >= '${getDateWithOffset(-7)}'`;
                        previousDateFilter = `AND date(started_at) >= '${getDateWithOffset(-14)}' AND date(started_at) < '${getDateWithOffset(-7)}'`;
                        periodDays = 7;
                        break;
                    case '30days':
                        dateFilter = `AND date(started_at) >= '${getDateWithOffset(-30)}'`;
                        previousDateFilter = `AND date(started_at) >= '${getDateWithOffset(-60)}' AND date(started_at) < '${getDateWithOffset(-30)}'`;
                        periodDays = 30;
                        break;
                    default:
                        dateFilter = '';
                        previousDateFilter = '';
                        periodDays = 0;
                }
            }

            // Overview stats - Current period
            const overview = queryOne(`
                SELECT 
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT ip_address) as unique_visitors,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    COALESCE(AVG(duration_seconds), 0) as avg_session_duration,
                    COALESCE(MAX(duration_seconds), 0) as longest_session
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
            `) || {};

            // Overview stats - Previous period (for comparison)
            const previousOverview = periodDays > 0 ? (queryOne(`
                SELECT 
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT ip_address) as unique_visitors,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    COALESCE(AVG(duration_seconds), 0) as avg_session_duration
                FROM viewer_session_history
                WHERE 1=1 ${previousDateFilter}
            `) || {}) : null;

            // Calculate trends (percentage change)
            const calculateTrend = (current, previous) => {
                if (!previous || previous === 0) return 0;
                return Math.round(((current - previous) / previous) * 100);
            };

            const trends = previousOverview ? {
                totalSessions: calculateTrend(overview.total_sessions, previousOverview.total_sessions),
                uniqueVisitors: calculateTrend(overview.unique_visitors, previousOverview.unique_visitors),
                totalWatchTime: calculateTrend(overview.total_watch_time, previousOverview.total_watch_time),
                avgSessionDuration: calculateTrend(overview.avg_session_duration, previousOverview.avg_session_duration)
            } : null;

            // Retention metrics: New vs Returning visitors (OPTIMIZED)
            // Menggunakan LEFT JOIN dan GROUP BY untuk performa lebih baik
            const retentionMetrics = queryOne(`
                SELECT 
                    COUNT(DISTINCT CASE WHEN visit_count = 1 THEN h1.ip_address END) as new_visitors,
                    COUNT(DISTINCT CASE WHEN visit_count > 1 THEN h1.ip_address END) as returning_visitors,
                    COUNT(DISTINCT CASE WHEN h1.duration_seconds < 10 THEN h1.ip_address END) as bounced_visitors,
                    COUNT(DISTINCT h1.ip_address) as total_unique_visitors
                FROM viewer_session_history h1
                LEFT JOIN (
                    SELECT ip_address, COUNT(*) as visit_count
                    FROM viewer_session_history
                    WHERE date(started_at) <= date('${todayDate}')
                    GROUP BY ip_address
                ) h2 ON h1.ip_address = h2.ip_address
                WHERE 1=1 ${dateFilter}
            `) || {};

            const bounceRate = retentionMetrics.total_unique_visitors > 0 
                ? Math.round((retentionMetrics.bounced_visitors / retentionMetrics.total_unique_visitors) * 100)
                : 0;

            const retentionRate = retentionMetrics.total_unique_visitors > 0
                ? Math.round((retentionMetrics.returning_visitors / retentionMetrics.total_unique_visitors) * 100)
                : 0;

            // Sessions by day (for chart)
            const sessionsByDay = query(`
                SELECT 
                    date(started_at) as date,
                    COUNT(*) as sessions,
                    COUNT(DISTINCT ip_address) as unique_visitors,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY date(started_at)
                ORDER BY date ASC
            `);

            // Sessions by hour (for heatmap) - now correctly shows WIB hours
            const sessionsByHour = query(`
                SELECT 
                    strftime('%H', started_at) as hour,
                    COUNT(*) as sessions
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%H', started_at)
                ORDER BY hour ASC
            `);

            // Activity Heatmap: 24 hours x 7 days
            // 0 = Sunday, 1 = Monday, ..., 6 = Saturday (SQLite strftime '%w')
            const activityHeatmap = query(`
                SELECT 
                    strftime('%w', started_at) as day_of_week,
                    strftime('%H', started_at) as hour,
                    COUNT(*) as sessions,
                    COUNT(DISTINCT ip_address) as unique_visitors
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%w', started_at), strftime('%H', started_at)
                ORDER BY day_of_week, hour
            `);

            // Top cameras by views
            const topCameras = query(`
                SELECT 
                    camera_id,
                    camera_name,
                    COUNT(*) as total_views,
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    COALESCE(AVG(duration_seconds), 0) as avg_duration
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY camera_id, camera_name
                ORDER BY total_views DESC
                LIMIT 10
            `);

            // Device breakdown
            const deviceBreakdown = query(`
                SELECT 
                    device_type,
                    COUNT(*) as count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM viewer_session_history WHERE 1=1 ${dateFilter}), 1) as percentage
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY device_type
                ORDER BY count DESC
            `);

            // Top visitors by IP
            const topVisitors = query(`
                SELECT 
                    ip_address,
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT camera_id) as cameras_watched,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    MAX(started_at) as last_visit
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY ip_address
                ORDER BY total_sessions DESC
                LIMIT 20
            `);

            // Recent sessions
            const recentSessions = query(`
                SELECT 
                    id,
                    camera_id,
                    camera_name,
                    ip_address,
                    device_type,
                    started_at,
                    ended_at,
                    duration_seconds
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                ORDER BY started_at DESC
                LIMIT 50
            `);

            // Peak hours analysis - now correctly shows WIB hours
            const peakHours = query(`
                SELECT 
                    strftime('%H', started_at) as hour,
                    COUNT(*) as sessions,
                    COUNT(DISTINCT ip_address) as unique_visitors
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%H', started_at)
                ORDER BY sessions DESC
                LIMIT 5
            `);

            // Current active viewers
            const activeViewers = this.getTotalActiveViewers();
            const activeSessions = this.getActiveSessions();

            // Camera performance metrics
            const cameraPerformance = query(`
                SELECT 
                    camera_id,
                    camera_name,
                    COUNT(*) as total_sessions,
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COALESCE(AVG(duration_seconds), 0) as avg_watch_time,
                    COALESCE(SUM(CASE WHEN duration_seconds < 10 THEN 1 ELSE 0 END), 0) as quick_exits,
                    COALESCE(SUM(CASE WHEN duration_seconds >= 60 THEN 1 ELSE 0 END), 0) as engaged_sessions,
                    ROUND(COALESCE(SUM(CASE WHEN duration_seconds < 10 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0), 1) as bounce_rate,
                    ROUND(COALESCE(SUM(CASE WHEN duration_seconds >= 60 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 0), 1) as engagement_rate
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY camera_id, camera_name
                ORDER BY total_sessions DESC
            `);

            return {
                period,
                overview: {
                    totalSessions: overview.total_sessions || 0,
                    uniqueVisitors: overview.unique_visitors || 0,
                    totalWatchTime: overview.total_watch_time || 0,
                    avgSessionDuration: Math.round(overview.avg_session_duration || 0),
                    longestSession: overview.longest_session || 0,
                    activeViewers,
                },
                // Comparison data with previous period
                comparison: previousOverview ? {
                    previous: {
                        totalSessions: previousOverview.total_sessions || 0,
                        uniqueVisitors: previousOverview.unique_visitors || 0,
                        totalWatchTime: previousOverview.total_watch_time || 0,
                        avgSessionDuration: Math.round(previousOverview.avg_session_duration || 0),
                    },
                    trends: trends
                } : null,
                // Retention metrics
                retention: {
                    newVisitors: retentionMetrics.new_visitors || 0,
                    returningVisitors: retentionMetrics.returning_visitors || 0,
                    bouncedVisitors: retentionMetrics.bounced_visitors || 0,
                    bounceRate: bounceRate,
                    retentionRate: retentionRate,
                },
                charts: {
                    sessionsByDay,
                    sessionsByHour,
                    activityHeatmap,
                },
                topCameras,
                deviceBreakdown,
                topVisitors,
                recentSessions,
                peakHours,
                // Camera performance metrics
                cameraPerformance,
                activeSessions: activeSessions.map(s => ({
                    sessionId: s.session_id,
                    cameraId: s.camera_id,
                    cameraName: s.camera_name,
                    ipAddress: s.ip_address,
                    deviceType: s.device_type,
                    startedAt: s.started_at,
                    durationSeconds: s.duration_seconds
                })),
            };
        } catch (error) {
            console.error('[ViewerSession] Error getting analytics:', error);
            return {
                period,
                overview: {
                    totalSessions: 0,
                    uniqueVisitors: 0,
                    totalWatchTime: 0,
                    avgSessionDuration: 0,
                    longestSession: 0,
                    activeViewers: 0,
                },
                comparison: null,
                retention: {
                    newVisitors: 0,
                    returningVisitors: 0,
                    bouncedVisitors: 0,
                    bounceRate: 0,
                    retentionRate: 0,
                },
                charts: { sessionsByDay: [], sessionsByHour: [], activityHeatmap: [] },
                topCameras: [],
                deviceBreakdown: [],
                topVisitors: [],
                recentSessions: [],
                peakHours: [],
                cameraPerformance: [],
                activeSessions: [],
            };
        }
    }

    /**
     * Get real-time viewer data for live dashboard
     */
    getRealTimeData() {
        try {
            const activeViewers = this.getTotalActiveViewers();
            const activeSessions = this.getActiveSessions();
            const viewersByCamera = this.getViewerCountByCamera();
            const timestamp = getTimestamp();

            // Get last 5 minutes activity (using configured timezone)
            const recentActivity = query(`
                SELECT 
                    camera_name,
                    ip_address,
                    device_type,
                    started_at
                FROM viewer_session_history
                WHERE datetime(started_at) >= datetime(?, '-5 minutes')
                ORDER BY started_at DESC
                LIMIT 10
            `, [timestamp]);

            return {
                activeViewers,
                activeSessions: activeSessions.map(s => ({
                    sessionId: s.session_id,
                    cameraId: s.camera_id,
                    cameraName: s.camera_name,
                    ipAddress: s.ip_address,
                    deviceType: s.device_type,
                    startedAt: s.started_at,
                    durationSeconds: s.duration_seconds
                })),
                viewersByCamera: viewersByCamera.map(v => ({
                    cameraId: v.camera_id,
                    viewerCount: v.viewer_count
                })),
                recentActivity,
                timestamp: timestamp,
            };
        } catch (error) {
            console.error('[ViewerSession] Error getting real-time data:', error);
            return {
                activeViewers: 0,
                activeSessions: [],
                viewersByCamera: [],
                recentActivity: [],
                timestamp: getTimestamp(),
            };
        }
    }
}

export default new ViewerSessionService();
