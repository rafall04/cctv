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

import { query, queryOne, execute } from '../database/connectionPool.js';
import { v4 as uuidv4 } from 'uuid';
import { getTimezone } from './timezoneService.js';
import viewerAnalyticsService from './viewerAnalyticsService.js';

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

// Cleanup interval in milliseconds - OPTIMIZED (reduced from 5s to 60s)
// Less frequent cleanup reduces database writes while maintaining effectiveness
const CLEANUP_INTERVAL = 60000;

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
        // Delegated to newly created viewerAnalyticsService to separate concerns (Single Responsibility Principle)
        const activeViewers = this.getTotalActiveViewers();
        const activeSessions = this.getActiveSessions();
        return viewerAnalyticsService.getAnalytics(period, activeViewers, activeSessions);
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
