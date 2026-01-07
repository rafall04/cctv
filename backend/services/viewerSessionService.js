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
}

export default new ViewerSessionService();
