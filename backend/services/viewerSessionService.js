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
 */

import { query, queryOne, execute } from '../database/database.js';
import { v4 as uuidv4 } from 'uuid';

// Session timeout in seconds (if no heartbeat received)
// Reduced from 30s to 15s for more realtime data
const SESSION_TIMEOUT = 15;

// Cleanup interval in milliseconds
// Reduced from 15s to 5s for faster stale session detection
const CLEANUP_INTERVAL = 5000; // 5 seconds

class ViewerSessionService {
    constructor() {
        this.cleanupInterval = null;
    }

    /**
     * Start the cleanup interval
     */
    startCleanup() {
        if (this.cleanupInterval) return;
        
        this.cleanupInterval = setInterval(() => {
            this.cleanupStaleSessions();
        }, CLEANUP_INTERVAL);
        
        console.log('[ViewerSession] Cleanup service started');
    }

    /**
     * Stop the cleanup interval
     */
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            console.log('[ViewerSession] Cleanup service stopped');
        }
    }

    /**
     * Extract real IP from request (handles proxy headers)
     */
    getRealIP(request) {
        // Check various proxy headers
        const forwardedFor = request.headers['x-forwarded-for'];
        if (forwardedFor) {
            // X-Forwarded-For can contain multiple IPs, first one is the client
            return forwardedFor.split(',')[0].trim();
        }
        
        const realIP = request.headers['x-real-ip'];
        if (realIP) {
            return realIP.trim();
        }
        
        // Fallback to direct IP
        return request.ip || request.socket?.remoteAddress || 'unknown';
    }

    /**
     * Parse user agent to determine device type
     */
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

    /**
     * Start a new viewer session
     * @returns {string} Session ID
     */
    startSession(cameraId, request) {
        const sessionId = uuidv4();
        const ipAddress = this.getRealIP(request);
        const userAgent = request.headers['user-agent'] || '';
        const deviceType = this.getDeviceType(userAgent);

        try {
            execute(`
                INSERT INTO viewer_sessions (session_id, camera_id, ip_address, user_agent, device_type)
                VALUES (?, ?, ?, ?, ?)
            `, [sessionId, cameraId, ipAddress, userAgent, deviceType]);

            console.log(`[ViewerSession] Started: ${sessionId} for camera ${cameraId} from ${ipAddress}`);
            return sessionId;
        } catch (error) {
            console.error('[ViewerSession] Error starting session:', error);
            throw error;
        }
    }

    /**
     * Update session heartbeat (keep-alive)
     */
    heartbeat(sessionId) {
        try {
            const result = execute(`
                UPDATE viewer_sessions 
                SET last_heartbeat = CURRENT_TIMESTAMP
                WHERE session_id = ? AND is_active = 1
            `, [sessionId]);

            return result.changes > 0;
        } catch (error) {
            console.error('[ViewerSession] Error updating heartbeat:', error);
            return false;
        }
    }

    /**
     * End a viewer session
     */
    endSession(sessionId) {
        try {
            // Get session info before ending
            const session = queryOne(`
                SELECT * FROM viewer_sessions WHERE session_id = ? AND is_active = 1
            `, [sessionId]);

            if (!session) {
                return false;
            }

            // Calculate duration
            const startedAt = new Date(session.started_at + 'Z');
            const endedAt = new Date();
            const durationSeconds = Math.floor((endedAt - startedAt) / 1000);

            // Update session as ended
            execute(`
                UPDATE viewer_sessions 
                SET is_active = 0, 
                    ended_at = CURRENT_TIMESTAMP,
                    duration_seconds = ?
                WHERE session_id = ?
            `, [durationSeconds, sessionId]);

            // Get camera name for history
            const camera = queryOne('SELECT name FROM cameras WHERE id = ?', [session.camera_id]);

            // Store in history
            execute(`
                INSERT INTO viewer_session_history 
                (camera_id, camera_name, ip_address, user_agent, device_type, started_at, ended_at, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            `, [
                session.camera_id,
                camera?.name || `Camera ${session.camera_id}`,
                session.ip_address,
                session.user_agent,
                session.device_type,
                session.started_at,
                durationSeconds
            ]);

            console.log(`[ViewerSession] Ended: ${sessionId} (duration: ${durationSeconds}s)`);
            return true;
        } catch (error) {
            console.error('[ViewerSession] Error ending session:', error);
            return false;
        }
    }

    /**
     * Cleanup stale sessions (no heartbeat for SESSION_TIMEOUT seconds)
     */
    cleanupStaleSessions() {
        try {
            // Find stale sessions
            const staleSessions = query(`
                SELECT session_id FROM viewer_sessions 
                WHERE is_active = 1 
                AND datetime(last_heartbeat) < datetime('now', '-${SESSION_TIMEOUT} seconds')
            `);

            for (const session of staleSessions) {
                this.endSession(session.session_id);
                console.log(`[ViewerSession] Cleaned up stale session: ${session.session_id}`);
            }

            if (staleSessions.length > 0) {
                console.log(`[ViewerSession] Cleaned up ${staleSessions.length} stale sessions`);
            }
        } catch (error) {
            console.error('[ViewerSession] Error cleaning up sessions:', error);
        }
    }

    /**
     * Get all active sessions
     */
    getActiveSessions() {
        try {
            return query(`
                SELECT 
                    vs.session_id,
                    vs.camera_id,
                    c.name as camera_name,
                    vs.ip_address,
                    vs.device_type,
                    vs.started_at,
                    vs.last_heartbeat,
                    CAST((julianday('now') - julianday(vs.started_at)) * 86400 AS INTEGER) as duration_seconds
                FROM viewer_sessions vs
                LEFT JOIN cameras c ON vs.camera_id = c.id
                WHERE vs.is_active = 1
                ORDER BY vs.started_at DESC
            `);
        } catch (error) {
            console.error('[ViewerSession] Error getting active sessions:', error);
            return [];
        }
    }

    /**
     * Get active sessions for a specific camera
     */
    getActiveSessionsByCamera(cameraId) {
        try {
            return query(`
                SELECT 
                    session_id,
                    ip_address,
                    device_type,
                    started_at,
                    last_heartbeat,
                    CAST((julianday('now') - julianday(started_at)) * 86400 AS INTEGER) as duration_seconds
                FROM viewer_sessions
                WHERE camera_id = ? AND is_active = 1
                ORDER BY started_at DESC
            `, [cameraId]);
        } catch (error) {
            console.error('[ViewerSession] Error getting camera sessions:', error);
            return [];
        }
    }

    /**
     * Get viewer count per camera
     */
    getViewerCountByCamera() {
        try {
            return query(`
                SELECT 
                    camera_id,
                    COUNT(*) as viewer_count
                FROM viewer_sessions
                WHERE is_active = 1
                GROUP BY camera_id
            `);
        } catch (error) {
            console.error('[ViewerSession] Error getting viewer counts:', error);
            return [];
        }
    }

    /**
     * Get total active viewer count
     */
    getTotalActiveViewers() {
        try {
            const result = queryOne(`
                SELECT COUNT(*) as count FROM viewer_sessions WHERE is_active = 1
            `);
            return result?.count || 0;
        } catch (error) {
            console.error('[ViewerSession] Error getting total viewers:', error);
            return 0;
        }
    }

    /**
     * Get session history with pagination
     */
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

    /**
     * Get viewer statistics summary
     */
    getViewerStats() {
        try {
            const activeViewers = this.getTotalActiveViewers();
            const activeSessions = this.getActiveSessions();
            const viewersByCamera = this.getViewerCountByCamera();

            // Get today's total unique viewers
            const todayStats = queryOne(`
                SELECT 
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COUNT(*) as total_sessions,
                    SUM(duration_seconds) as total_watch_time
                FROM viewer_session_history
                WHERE date(started_at) = date('now')
            `);

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
     * @param {string} period - 'today', '7days', '30days', 'all'
     */
    getAnalytics(period = '7days') {
        try {
            // Determine date filter
            let dateFilter = '';
            switch (period) {
                case 'today':
                    dateFilter = "AND date(started_at) = date('now')";
                    break;
                case '7days':
                    dateFilter = "AND date(started_at) >= date('now', '-7 days')";
                    break;
                case '30days':
                    dateFilter = "AND date(started_at) >= date('now', '-30 days')";
                    break;
                default:
                    dateFilter = '';
            }

            // Overview stats
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

            // Sessions by hour (for heatmap)
            const sessionsByHour = query(`
                SELECT 
                    strftime('%H', started_at) as hour,
                    COUNT(*) as sessions
                FROM viewer_session_history
                WHERE 1=1 ${dateFilter}
                GROUP BY strftime('%H', started_at)
                ORDER BY hour ASC
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

            // Peak hours analysis
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
                charts: {
                    sessionsByDay,
                    sessionsByHour,
                },
                topCameras,
                deviceBreakdown,
                topVisitors,
                recentSessions,
                peakHours,
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
                charts: { sessionsByDay: [], sessionsByHour: [] },
                topCameras: [],
                deviceBreakdown: [],
                topVisitors: [],
                recentSessions: [],
                peakHours: [],
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

            // Get last 5 minutes activity
            const recentActivity = query(`
                SELECT 
                    camera_name,
                    ip_address,
                    device_type,
                    started_at
                FROM viewer_session_history
                WHERE datetime(started_at) >= datetime('now', '-5 minutes')
                ORDER BY started_at DESC
                LIMIT 10
            `);

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
                timestamp: new Date().toISOString(),
            };
        } catch (error) {
            console.error('[ViewerSession] Error getting real-time data:', error);
            return {
                activeViewers: 0,
                activeSessions: [],
                viewersByCamera: [],
                recentActivity: [],
                timestamp: new Date().toISOString(),
            };
        }
    }
}

export default new ViewerSessionService();
