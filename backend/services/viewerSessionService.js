/**
 * Purpose: Manage real-time live viewer sessions and historical live-view analytics for CCTV streams.
 * Caller: viewer routes, HLS proxy/session cleanup, backend startup cleanup timer.
 * Deps: connectionPool, uuid, timeService, viewerAnalyticsService, cacheService, cameraViewStatsService, network identity/policy services.
 * MainFuncs: startSession, heartbeat, endSession, cleanupStaleSessions, getViewerStats, getSessionHistory.
 * SideEffects: Writes viewer session/history rows, updates camera lifetime view counters, and runs cleanup timers.
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
import viewerAnalyticsService from './viewerAnalyticsService.js';
import { cacheGetOrSetSync, cacheKey, CacheNamespace, CacheTTL } from './cacheService.js';
import cameraViewStatsService from './cameraViewStatsService.js';
import networkIdentityService from './networkIdentityService.js';
import networkAccessPolicyService from './networkAccessPolicyService.js';
import { logSecurityEvent, SECURITY_EVENTS } from './securityAuditLogger.js';
import { diffLocalSqlSeconds, getLocalDate, getLocalDateWithOffset, getLocalSqlWithOffsetDays, nowLocalSql, resolveLocalSqlTimestamp } from './timeService.js';
import { getTrustedViewerIdentity } from '../utils/trustedProxyIdentity.js';

/**
 * Get current date in configured timezone for date comparisons
 * Format: YYYY-MM-DD
 */
function getDate() {
    return getLocalDate();
}

/**
 * Get date with offset (e.g., -7 days) in configured timezone
 * Format: YYYY-MM-DD
 */
function getDateWithOffset(days) {
    return getLocalDateWithOffset(days);
}

function buildHistoryDateFilter(period) {
    const todayDate = getDate();

    if (typeof period === 'string' && period.startsWith('date:')) {
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

function buildHistoryFilters({ cameraId = null, deviceType = '', search = '' } = {}) {
    const clauses = [];
    const params = [];
    const normalizedCameraId = Number.parseInt(cameraId, 10);

    if (Number.isInteger(normalizedCameraId) && normalizedCameraId > 0) {
        clauses.push('AND camera_id = ?');
        params.push(normalizedCameraId);
    }

    if (typeof deviceType === 'string' && ['desktop', 'mobile', 'tablet', 'unknown'].includes(deviceType)) {
        clauses.push('AND device_type = ?');
        params.push(deviceType);
    }

    if (typeof search === 'string' && search.trim()) {
        const likeValue = `%${search.trim()}%`;
        clauses.push('AND (camera_name LIKE ? OR ip_address LIKE ? OR device_type LIKE ? OR asn_org LIKE ? OR CAST(asn_number AS TEXT) LIKE ? OR network_lookup_source LIKE ?)');
        params.push(likeValue, likeValue, likeValue, likeValue, likeValue, likeValue);
    }

    return {
        clause: clauses.join(' '),
        params,
    };
}

function resolveHistorySort(sortBy = 'started_at', sortDirection = 'desc') {
    const sortMap = {
        camera_name: 'camera_name',
        ip_address: 'ip_address',
        device_type: 'device_type',
        started_at: 'started_at',
        ended_at: 'ended_at',
        duration_seconds: 'duration_seconds',
    };
    const column = sortMap[sortBy] || 'started_at';
    const direction = String(sortDirection).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    return `${column} ${direction}`;
}

// Session timeout in seconds (if no heartbeat received)
const SESSION_TIMEOUT = 15;
const HISTORY_RETENTION_DAYS = 90;
const RETENTION_RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;

// Cleanup interval in milliseconds - OPTIMIZED (reduced from 5s to 60s)
// Less frequent cleanup reduces database writes while maintaining effectiveness
const CLEANUP_INTERVAL = 60000;

class ViewerSessionService {
    constructor() {
        this.cleanupInterval = null;
        this.lastRetentionRunAt = 0;
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
        return getTrustedViewerIdentity(request);
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
        const timestamp = nowLocalSql();
        const networkIdentity = networkIdentityService.resolveIpIdentity(ipAddress);
        let accessDecision;
        try {
            accessDecision = networkAccessPolicyService.enforceAccess({
                cameraId,
                accessFlow: 'live',
                identity: networkIdentity,
            });
        } catch (error) {
            if (error.statusCode === 403) {
                logSecurityEvent(SECURITY_EVENTS.NETWORK_ACCESS_DENIED, {
                    flow: 'live',
                    camera_id: cameraId,
                    ip_address: ipAddress,
                    asn_number: networkIdentity.asnNumber || null,
                    asn_org: networkIdentity.asnOrg || 'unknown',
                    network_lookup_source: networkIdentity.lookupSource || 'unavailable',
                    network_lookup_version: networkIdentity.lookupVersion || 'unavailable',
                    policy_mode: error.decision?.policy?.mode || 'observe_only',
                    policy_scope: error.decision?.policy?.scope || 'global',
                    policy_target_id: error.decision?.policy?.targetId ?? null,
                    policy_access_flow: error.decision?.policy?.accessFlow || 'live',
                    reason: error.decision?.reason || 'denied',
                }, request);
            }
            throw error;
        }

        try {
            execute(`
                INSERT INTO viewer_sessions (
                    session_id,
                    camera_id,
                    ip_address,
                    user_agent,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
                    started_at,
                    last_heartbeat
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                sessionId,
                cameraId,
                ipAddress,
                userAgent,
                deviceType,
                networkIdentity.asnNumber || null,
                networkIdentity.asnOrg || 'unknown',
                networkIdentity.lookupSource || 'unavailable',
                networkIdentity.lookupVersion || 'unavailable',
                timestamp,
                timestamp
            ]);

            logSecurityEvent(SECURITY_EVENTS.NETWORK_ACCESS_ALLOWED, {
                flow: 'live',
                camera_id: cameraId,
                session_id: sessionId,
                ip_address: ipAddress,
                asn_number: networkIdentity.asnNumber || null,
                asn_org: networkIdentity.asnOrg || 'unknown',
                network_lookup_source: networkIdentity.lookupSource || 'unavailable',
                network_lookup_version: networkIdentity.lookupVersion || 'unavailable',
                policy_mode: accessDecision.policy?.mode || 'observe_only',
                policy_scope: accessDecision.policy?.scope || 'global',
                policy_target_id: accessDecision.policy?.targetId ?? null,
                policy_access_flow: accessDecision.policy?.accessFlow || 'live',
            }, request);

            console.log(`[ViewerSession] Started: ${sessionId} for camera ${cameraId} from ${ipAddress} at ${timestamp}`);
            return sessionId;
        } catch (error) {
            console.error('[ViewerSession] Error starting session:', error);
            throw error;
        }
    }

    heartbeat(sessionId) {
        try {
            const timestamp = nowLocalSql();
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

    endSession(sessionId, options = {}) {
        try {
            const session = queryOne(`
                SELECT * FROM viewer_sessions WHERE session_id = ? AND is_active = 1
            `, [sessionId]);

            if (!session) return false;

            const rawEndTimestamp = options.endedAtMs ?? options.endedAt ?? new Date();
            const timestamp = resolveLocalSqlTimestamp(rawEndTimestamp);
            const durationSeconds = diffLocalSqlSeconds(session.started_at, timestamp);

            execute(`
                UPDATE viewer_sessions 
                SET is_active = 0, ended_at = ?, duration_seconds = ?
                WHERE session_id = ?
            `, [timestamp, durationSeconds, sessionId]);

            const camera = queryOne('SELECT name FROM cameras WHERE id = ?', [session.camera_id]);

            execute(`
                INSERT INTO viewer_session_history 
                (camera_id, camera_name, ip_address, user_agent, device_type, asn_number, asn_org, network_lookup_source, network_lookup_version, started_at, ended_at, duration_seconds)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                session.camera_id,
                camera?.name || `Camera ${session.camera_id}`,
                session.ip_address,
                session.user_agent,
                session.device_type,
                session.asn_number ?? null,
                session.asn_org || 'unknown',
                session.network_lookup_source || 'unavailable',
                session.network_lookup_version || 'unavailable',
                session.started_at,
                timestamp,
                durationSeconds
            ]);

            cameraViewStatsService.recordCompletedLiveView({
                cameraId: session.camera_id,
                durationSeconds,
                viewedAt: timestamp,
            });

            console.log(`[ViewerSession] Ended: ${sessionId} (duration: ${durationSeconds}s)`);
            return true;
        } catch (error) {
            console.error('[ViewerSession] Error ending session:', error);
            return false;
        }
    }

    cleanupStaleSessions() {
        try {
            const timestamp = nowLocalSql();
            const staleSessions = query(`
                SELECT session_id, last_heartbeat FROM viewer_sessions 
                WHERE is_active = 1 
                AND datetime(last_heartbeat) < datetime(?, '-${SESSION_TIMEOUT} seconds')
            `, [timestamp]);

            for (const session of staleSessions) {
                this.endSession(session.session_id, { endedAt: session.last_heartbeat });
            }

            if (staleSessions.length > 0) {
                console.log(`[ViewerSession] Cleaned up ${staleSessions.length} stale sessions`);
            }

            this.runRetentionIfDue();
        } catch (error) {
            console.error('[ViewerSession] Error cleaning up sessions:', error);
        }
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
            const cutoff = getLocalSqlWithOffsetDays(-retentionDays);

            execute(`
                INSERT INTO viewer_session_history_archive (
                    id,
                    camera_id,
                    camera_name,
                    ip_address,
                    user_agent,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
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
                    ip_address,
                    user_agent,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
                    started_at,
                    ended_at,
                    duration_seconds,
                    created_at,
                    CURRENT_TIMESTAMP
                FROM viewer_session_history
                WHERE datetime(started_at) < datetime(?)
                AND NOT EXISTS (
                    SELECT 1
                    FROM viewer_session_history_archive archive
                    WHERE archive.id = viewer_session_history.id
                )
            `, [cutoff]);

            execute(`
                DELETE FROM viewer_session_history
                WHERE datetime(started_at) < datetime(?)
            `, [cutoff]);
        } catch (error) {
            if (!String(error?.message || '').includes('no such table')) {
                console.error('[ViewerSession] Error archiving history:', error);
            }
        }
    }

    getActiveSessions() {
        try {
            const timestamp = nowLocalSql();
            return query(`
                SELECT 
                    vs.session_id,
                    vs.camera_id,
                    c.name as camera_name,
                    vs.ip_address,
                    vs.device_type,
                    vs.asn_number,
                    vs.asn_org,
                    vs.network_lookup_source,
                    vs.network_lookup_version,
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
            const timestamp = nowLocalSql();
            return query(`
                SELECT 
                    session_id,
                    ip_address,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
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

    getHistoryPage({
        period = '7days',
        page = 1,
        pageSize = 25,
        cameraId = null,
        deviceType = '',
        search = '',
        sortBy = 'started_at',
        sortDirection = 'desc',
    } = {}) {
        try {
            const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 25));
            const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
            const offset = (safePage - 1) * safePageSize;
            const dateFilter = buildHistoryDateFilter(period);
            const filters = buildHistoryFilters({ cameraId, deviceType, search });
            const whereClause = `${dateFilter.clause} ${filters.clause}`.trim();
            const params = [...dateFilter.params, ...filters.params];
            const orderBy = resolveHistorySort(sortBy, sortDirection);

            const totalResult = queryOne(`
                SELECT COUNT(*) as total_items
                FROM viewer_session_history
                WHERE 1 = 1
                ${whereClause}
            `, params);

            const summary = queryOne(`
                SELECT
                    COUNT(*) as total_items,
                    COUNT(DISTINCT ip_address) as unique_viewers,
                    COALESCE(SUM(duration_seconds), 0) as total_watch_time
                FROM viewer_session_history
                WHERE 1 = 1
                ${whereClause}
            `, params);

            const items = query(`
                SELECT
                    id,
                    camera_id,
                    camera_name,
                    ip_address,
                    user_agent,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
                    started_at,
                    ended_at,
                    duration_seconds
                FROM viewer_session_history
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
        } catch (error) {
            console.error('[ViewerSession] Error getting paginated history:', error);
            return {
                items: [],
                pagination: { page: 1, pageSize: 25, totalItems: 0, totalPages: 1 },
                summary: { totalItems: 0, uniqueViewers: 0, totalWatchTime: 0 },
            };
        }
    }

    getViewerStats() {
        try {
            return cacheGetOrSetSync(
                cacheKey(CacheNamespace.STATS, 'camera-viewer-stats', 'today'),
                () => {
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
                },
                CacheTTL.SHORT
            );
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
        return cacheGetOrSetSync(
            cacheKey(CacheNamespace.STATS, 'camera-viewer-analytics', period),
            () => {
                const activeViewers = this.getTotalActiveViewers();
                const activeSessions = this.getActiveSessions();
                return viewerAnalyticsService.getAnalytics(period, activeViewers, activeSessions);
            },
            CacheTTL.SHORT
        );
    }

    /**
     * Get real-time viewer data for live dashboard
     */
    getRealTimeData() {
        try {
            const activeViewers = this.getTotalActiveViewers();
            const activeSessions = this.getActiveSessions();
            const viewersByCamera = this.getViewerCountByCamera();
            const timestamp = nowLocalSql();

            // Get last 5 minutes activity (using configured timezone)
            const recentActivity = query(`
                SELECT 
                    camera_name,
                    ip_address,
                    device_type,
                    asn_number,
                    asn_org,
                    network_lookup_source,
                    network_lookup_version,
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
                    asnNumber: s.asn_number,
                    asnOrg: s.asn_org,
                    networkLookupSource: s.network_lookup_source,
                    networkLookupVersion: s.network_lookup_version,
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
                timestamp: nowLocalSql(),
            };
        }
    }
}

export default new ViewerSessionService();
