import { query, queryOne } from '../database/connectionPool.js';
import { getTimezone } from './timezoneService.js';
// Removed circular dependency import

/**
 * Viewer Analytics Service
 * Responsible for querying and standardizing analytics from viewer sessions.
 */

function getDate() {
    const timezone = getTimezone();
    return new Date().toLocaleDateString('sv-SE', {
        timeZone: timezone
    });
}

function getDateWithOffset(days) {
    const timezone = getTimezone();
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString('sv-SE', {
        timeZone: timezone
    });
}

class ViewerAnalyticsService {

    /**
     * Parse the given period and return date filters and days count.
     * @param {string} period - 'today', 'yesterday', '7days', '30days', 'all', or 'date:YYYY-MM-DD'
     */
    #parsePeriodFilters(period) {
        let dateFilter = '';
        let dateParams = [];
        let previousDateFilter = '';
        let previousDateParams = [];
        let periodDays = 0;
        const todayDate = getDate();

        if (period.startsWith('date:')) {
            const customDate = period.substring(5);
            if (/^\d{4}-\d{2}-\d{2}$/.test(customDate)) {
                dateFilter = `AND date(started_at) = ?`;
                dateParams = [customDate];
                const prevDate = new Date(customDate);
                prevDate.setDate(prevDate.getDate() - 1);
                const prevDateStr = prevDate.toISOString().split('T')[0];
                previousDateFilter = `AND date(started_at) = ?`;
                previousDateParams = [prevDateStr];
                periodDays = 1;
            } else {
                dateFilter = `AND date(started_at) >= ?`;
                dateParams = [getDateWithOffset(-7)];
                previousDateFilter = `AND date(started_at) >= ? AND date(started_at) < ?`;
                previousDateParams = [getDateWithOffset(-14), getDateWithOffset(-7)];
                periodDays = 7;
            }
        } else {
            switch (period) {
                case 'today':
                    dateFilter = `AND date(started_at) = ?`;
                    dateParams = [todayDate];
                    previousDateFilter = `AND date(started_at) = ?`;
                    previousDateParams = [getDateWithOffset(-1)];
                    periodDays = 1;
                    break;
                case 'yesterday':
                    dateFilter = `AND date(started_at) = ?`;
                    dateParams = [getDateWithOffset(-1)];
                    previousDateFilter = `AND date(started_at) = ?`;
                    previousDateParams = [getDateWithOffset(-2)];
                    periodDays = 1;
                    break;
                case '7days':
                    dateFilter = `AND date(started_at) >= ?`;
                    dateParams = [getDateWithOffset(-7)];
                    previousDateFilter = `AND date(started_at) >= ? AND date(started_at) < ?`;
                    previousDateParams = [getDateWithOffset(-14), getDateWithOffset(-7)];
                    periodDays = 7;
                    break;
                case '30days':
                    dateFilter = `AND date(started_at) >= ?`;
                    dateParams = [getDateWithOffset(-30)];
                    previousDateFilter = `AND date(started_at) >= ? AND date(started_at) < ?`;
                    previousDateParams = [getDateWithOffset(-60), getDateWithOffset(-30)];
                    periodDays = 30;
                    break;
                default:
                    dateFilter = '';
                    dateParams = [];
                    previousDateFilter = '';
                    previousDateParams = [];
                    periodDays = 0;
            }
        }
        return { dateFilter, dateParams, previousDateFilter, previousDateParams, periodDays, todayDate };
    }

    #getOverview(dateFilter, dateParams) {
        return queryOne(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_visitors,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                COALESCE(AVG(duration_seconds), 0) as avg_session_duration,
                COALESCE(MAX(duration_seconds), 0) as longest_session
            FROM viewer_session_history
            WHERE 1=1 ${dateFilter}
        `, dateParams) || {};
    }

    #getPreviousOverview(previousDateFilter, previousDateParams) {
        return queryOne(`
            SELECT 
                COUNT(*) as total_sessions,
                COUNT(DISTINCT ip_address) as unique_visitors,
                COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                COALESCE(AVG(duration_seconds), 0) as avg_session_duration
            FROM viewer_session_history
            WHERE 1=1 ${previousDateFilter}
        `, previousDateParams) || {};
    }

    #getRetentionMetrics(dateFilter, dateParams, todayDate) {
        return queryOne(`
            SELECT 
                COUNT(DISTINCT CASE WHEN visit_count = 1 THEN h1.ip_address END) as new_visitors,
                COUNT(DISTINCT CASE WHEN visit_count > 1 THEN h1.ip_address END) as returning_visitors,
                COUNT(DISTINCT CASE WHEN h1.duration_seconds < 10 THEN h1.ip_address END) as bounced_visitors,
                COUNT(DISTINCT h1.ip_address) as total_unique_visitors
            FROM viewer_session_history h1
            LEFT JOIN (
                SELECT ip_address, COUNT(*) as visit_count
                FROM viewer_session_history
                WHERE date(started_at) <= date(?)
                GROUP BY ip_address
            ) h2 ON h1.ip_address = h2.ip_address
            WHERE 1=1 ${dateFilter}
        `, [todayDate, ...dateParams]) || {};
    }

    #calculateTrend(current, previous) {
        if (!previous || previous === 0) return 0;
        return Math.round(((current - previous) / previous) * 100);
    }

    getAnalytics(period = '7days', activeViewers = 0, activeSessions = []) {
        try {
            const { dateFilter, dateParams, previousDateFilter, previousDateParams, periodDays, todayDate } = this.#parsePeriodFilters(period);

            const overview = this.#getOverview(dateFilter, dateParams);
            const previousOverview = periodDays > 0 ? this.#getPreviousOverview(previousDateFilter, previousDateParams) : null;

            const trends = previousOverview ? {
                totalSessions: this.#calculateTrend(overview.total_sessions, previousOverview.total_sessions),
                uniqueVisitors: this.#calculateTrend(overview.unique_visitors, previousOverview.unique_visitors),
                totalWatchTime: this.#calculateTrend(overview.total_watch_time, previousOverview.total_watch_time),
                avgSessionDuration: this.#calculateTrend(overview.avg_session_duration, previousOverview.avg_session_duration)
            } : null;

            const retentionMetrics = this.#getRetentionMetrics(dateFilter, dateParams, todayDate);
            const bounceRate = retentionMetrics.total_unique_visitors > 0
                ? Math.round((retentionMetrics.bounced_visitors / retentionMetrics.total_unique_visitors) * 100)
                : 0;
            const retentionRate = retentionMetrics.total_unique_visitors > 0
                ? Math.round((retentionMetrics.returning_visitors / retentionMetrics.total_unique_visitors) * 100)
                : 0;

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
            `, dateParams);

            const sessionsByHour = query(`
                SELECT 
                    strftime('%H', started_at) as hour,
                    COUNT(*) as sessions
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%H', started_at)
                ORDER BY hour ASC
            `, dateParams);

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
            `, dateParams);

            const topCameras = query(`
                SELECT 
                    camera_id, camera_name,
                    COUNT(*) as total_views,
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    COALESCE(AVG(duration_seconds), 0) as avg_duration
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY camera_id, camera_name
                ORDER BY total_views DESC LIMIT 10
            `, dateParams);

            const deviceBreakdown = query(`
                SELECT 
                    device_type, COUNT(*) as count,
                    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM viewer_session_history WHERE 1=1 ${dateFilter}), 1) as percentage
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY device_type ORDER BY count DESC
            `, [...dateParams, ...dateParams]);

            const topVisitors = query(`
                SELECT 
                    ip_address, COUNT(*) as total_sessions,
                    COUNT(DISTINCT camera_id) as cameras_watched,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time,
                    MAX(started_at) as last_visit
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY ip_address ORDER BY total_sessions DESC LIMIT 20
            `, dateParams);

            const recentSessions = query(`
                SELECT id, camera_id, camera_name, ip_address, device_type, started_at, ended_at, duration_seconds
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                ORDER BY started_at DESC LIMIT 50
            `, dateParams);

            const peakHours = query(`
                SELECT strftime('%H', started_at) as hour, COUNT(*) as sessions, COUNT(DISTINCT ip_address) as unique_visitors
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%H', started_at)
                ORDER BY sessions DESC LIMIT 5
            `, dateParams);

            const cameraPerformance = query(`
                SELECT 
                    camera_id, camera_name, COUNT(*) as total_sessions,
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
            `, dateParams);

            // activeViewers and activeSessions are passed as arguments to avoid circular dependency

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
                comparison: previousOverview ? {
                    previous: {
                        totalSessions: previousOverview.total_sessions || 0,
                        uniqueVisitors: previousOverview.unique_visitors || 0,
                        totalWatchTime: previousOverview.total_watch_time || 0,
                        avgSessionDuration: Math.round(previousOverview.avg_session_duration || 0),
                    },
                    trends: trends
                } : null,
                retention: {
                    newVisitors: retentionMetrics.new_visitors || 0,
                    returningVisitors: retentionMetrics.returning_visitors || 0,
                    bouncedVisitors: retentionMetrics.bounced_visitors || 0,
                    bounceRate: bounceRate,
                    retentionRate: retentionRate,
                },
                charts: { sessionsByDay, sessionsByHour, activityHeatmap },
                topCameras, deviceBreakdown, topVisitors, recentSessions, peakHours, cameraPerformance,
                activeSessions: activeSessions.map(s => ({
                    sessionId: s.session_id, cameraId: s.camera_id, cameraName: s.camera_name,
                    ipAddress: s.ip_address, deviceType: s.device_type, startedAt: s.started_at, durationSeconds: s.duration_seconds
                })),
            };
        } catch (error) {
            console.error('[ViewerAnalytics] Error getting analytics:', error);
            return {
                period,
                overview: { totalSessions: 0, uniqueVisitors: 0, totalWatchTime: 0, avgSessionDuration: 0, longestSession: 0, activeViewers: 0 },
                comparison: null,
                retention: { newVisitors: 0, returningVisitors: 0, bouncedVisitors: 0, bounceRate: 0, retentionRate: 0 },
                charts: { sessionsByDay: [], sessionsByHour: [], activityHeatmap: [] },
                topCameras: [], deviceBreakdown: [], topVisitors: [], recentSessions: [], peakHours: [], cameraPerformance: [], activeSessions: [],
            };
        }
    }
}

export default new ViewerAnalyticsService();
