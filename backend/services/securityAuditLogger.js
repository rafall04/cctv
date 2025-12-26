/**
 * Security Audit Logger Service
 * 
 * Comprehensive logging of security-related events for monitoring and forensics.
 * 
 * Features:
 * - Log authentication attempts (success/failure)
 * - Log rate limit violations
 * - Log API key validation failures
 * - Log CSRF token failures
 * - Log account lockout events
 * - Log admin actions
 * - Include fingerprint in all entries
 * - 90-day log retention with automatic cleanup
 * 
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

import crypto from 'crypto';
import { execute, query } from '../database/database.js';

/**
 * Security event types
 */
export const SECURITY_EVENTS = {
    AUTH_SUCCESS: 'AUTH_SUCCESS',
    AUTH_FAILURE: 'AUTH_FAILURE',
    ACCOUNT_LOCKOUT: 'ACCOUNT_LOCKOUT',
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    API_KEY_INVALID: 'API_KEY_INVALID',
    API_KEY_CREATED: 'API_KEY_CREATED',
    API_KEY_REVOKED: 'API_KEY_REVOKED',
    CSRF_INVALID: 'CSRF_INVALID',
    ORIGIN_VALIDATION_FAILURE: 'ORIGIN_VALIDATION_FAILURE',
    SESSION_INVALIDATED: 'SESSION_INVALIDATED',
    SESSION_CREATED: 'SESSION_CREATED',
    SESSION_REFRESHED: 'SESSION_REFRESHED',
    TOKEN_BLACKLISTED: 'TOKEN_BLACKLISTED',
    FINGERPRINT_MISMATCH: 'FINGERPRINT_MISMATCH',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    PASSWORD_VALIDATION_FAILED: 'PASSWORD_VALIDATION_FAILED',
    VALIDATION_FAILURE: 'VALIDATION_FAILURE',
    ADMIN_ACTION: 'ADMIN_ACTION',
    USER_CREATED: 'USER_CREATED',
    USER_UPDATED: 'USER_UPDATED',
    USER_DELETED: 'USER_DELETED',
    CAMERA_CREATED: 'CAMERA_CREATED',
    CAMERA_UPDATED: 'CAMERA_UPDATED',
    CAMERA_DELETED: 'CAMERA_DELETED'
};

// Alias for backward compatibility
export const EVENT_TYPES = SECURITY_EVENTS;

/**
 * Log retention period in days
 */
export const LOG_RETENTION_DAYS = 90;

/**
 * Generate fingerprint from request
 * Creates SHA256 hash of IP + User-Agent for consistent identification
 * @param {Object} request - Fastify request object
 * @returns {string} Fingerprint hash
 */
export function generateFingerprint(request) {
    if (!request) return 'unknown';
    
    const ip = request.ip || request.headers?.['x-forwarded-for'] || 'unknown';
    const userAgent = request.headers?.['user-agent'] || 'unknown';
    
    const data = `${ip}:${userAgent}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}


/**
 * Log a security event to the database
 * @param {string} eventType - Type of security event (from SECURITY_EVENTS)
 * @param {Object} details - Event details
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logSecurityEvent(eventType, details = {}, request = null) {
    const entry = {
        event_type: eventType,
        timestamp: new Date().toISOString(),
        ip_address: details.ip_address || request?.ip || request?.headers?.['x-forwarded-for'] || 'unknown',
        user_agent: details.user_agent || request?.headers?.['user-agent'] || 'unknown',
        fingerprint: details.fingerprint || generateFingerprint(request),
        username: details.username || null,
        endpoint: details.endpoint || request?.url || null,
        details: typeof details === 'string' ? details : JSON.stringify(details)
    };
    
    try {
        execute(`
            INSERT INTO security_logs (event_type, timestamp, ip_address, user_agent, fingerprint, username, endpoint, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            entry.event_type,
            entry.timestamp,
            entry.ip_address,
            entry.user_agent,
            entry.fingerprint,
            entry.username,
            entry.endpoint,
            entry.details
        ]);
    } catch (error) {
        // If database insert fails (e.g., table doesn't exist yet), log to console
        console.warn('[SECURITY_AUDIT] Database insert failed, logging to console:', error.message);
        console.log('[SECURITY_AUDIT]', JSON.stringify(entry));
    }
    
    return entry;
}

/**
 * Log authentication attempt (success or failure)
 * @param {boolean} success - Whether authentication succeeded
 * @param {Object} details - Authentication details
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logAuthAttempt(success, details, request = null) {
    const eventType = success ? SECURITY_EVENTS.AUTH_SUCCESS : SECURITY_EVENTS.AUTH_FAILURE;
    return logSecurityEvent(eventType, {
        ...details,
        success: success
    }, request);
}

/**
 * Log rate limit violation
 * @param {Object} details - Violation details (ip, url, endpointType, limit, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logRateLimitViolation(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.RATE_LIMIT_EXCEEDED, {
        ip_address: details.ip,
        endpoint: details.url,
        endpoint_type: details.endpointType,
        limit: details.limit,
        window_seconds: details.windowSeconds,
        retry_after: details.retryAfter,
        ...details
    }, request);
}

/**
 * Log API key validation failure
 * @param {Object} details - Failure details (reason, endpoint, method, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logApiKeyFailure(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.API_KEY_INVALID, {
        reason: details.reason,
        endpoint: details.endpoint,
        method: details.method,
        client_id: details.clientId,
        ...details
    }, request);
}

/**
 * Log API key creation
 * @param {Object} details - Creation details (clientName, keyId, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logApiKeyCreated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.API_KEY_CREATED, {
        client_name: details.clientName,
        key_id: details.keyId,
        created_by: details.createdBy,
        ...details
    }, request);
}

/**
 * Log API key revocation
 * @param {Object} details - Revocation details (keyId, clientName, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logApiKeyRevoked(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.API_KEY_REVOKED, {
        key_id: details.keyId,
        client_name: details.clientName,
        revoked_by: details.revokedBy,
        ...details
    }, request);
}


/**
 * Log CSRF validation failure
 * @param {Object} details - Failure details (reason, method, endpoint, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logCsrfFailure(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.CSRF_INVALID, {
        reason: details.reason,
        method: details.method,
        endpoint: details.endpoint,
        ...details
    }, request);
}

/**
 * Log account lockout event
 * @param {Object} details - Lockout details (username, ip, lockType, attempts, duration)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logAccountLockout(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.ACCOUNT_LOCKOUT, {
        username: details.username,
        ip_address: details.ip_address,
        lock_type: details.lockType,
        attempts: details.attempts,
        duration_minutes: details.duration_minutes,
        ...details
    }, request);
}

/**
 * Log session creation
 * @param {Object} details - Session details (userId, username, fingerprint)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logSessionCreated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.SESSION_CREATED, {
        user_id: details.userId,
        username: details.username,
        session_fingerprint: details.fingerprint?.substring(0, 16) + '...',
        ...details
    }, request);
}

/**
 * Log session refresh (token rotation)
 * @param {Object} details - Refresh details (userId, username)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logSessionRefreshed(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.SESSION_REFRESHED, {
        user_id: details.userId,
        username: details.username,
        ...details
    }, request);
}

/**
 * Log session invalidation
 * @param {Object} details - Invalidation details (userId, reason)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logSessionInvalidated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.SESSION_INVALIDATED, {
        user_id: details.userId,
        username: details.username,
        reason: details.reason,
        ...details
    }, request);
}

/**
 * Log token blacklisting
 * @param {Object} details - Blacklist details (userId, reason)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logTokenBlacklisted(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.TOKEN_BLACKLISTED, {
        user_id: details.userId,
        reason: details.reason,
        token_type: details.tokenType,
        ...details
    }, request);
}

/**
 * Log fingerprint mismatch (potential session hijacking)
 * @param {Object} details - Mismatch details (userId, expected, actual)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logFingerprintMismatch(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.FINGERPRINT_MISMATCH, {
        user_id: details.userId,
        username: details.username,
        expected_fingerprint: details.expectedFingerprint?.substring(0, 16) + '...',
        actual_fingerprint: details.actualFingerprint?.substring(0, 16) + '...',
        ...details
    }, request);
}

/**
 * Log password change
 * @param {Object} details - Change details (userId, username)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logPasswordChanged(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.PASSWORD_CHANGED, {
        user_id: details.userId,
        username: details.username,
        changed_by: details.changedBy,
        ...details
    }, request);
}

/**
 * Log password validation failure
 * @param {Object} details - Validation failure details (username, errors)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logPasswordValidationFailed(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.PASSWORD_VALIDATION_FAILED, {
        username: details.username,
        validation_errors: details.errors,
        ...details
    }, request);
}


/**
 * Log admin action (generic admin operations)
 * @param {Object} details - Action details (action, targetType, targetId, etc.)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logAdminAction(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.ADMIN_ACTION, {
        action: details.action,
        target_type: details.targetType,
        target_id: details.targetId,
        admin_user_id: details.adminUserId,
        admin_username: details.adminUsername,
        ...details
    }, request);
}

/**
 * Log user creation
 * @param {Object} details - Creation details (newUserId, newUsername, createdBy)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logUserCreated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.USER_CREATED, {
        new_user_id: details.newUserId,
        new_username: details.newUsername,
        created_by_user_id: details.createdByUserId,
        created_by_username: details.createdByUsername,
        role: details.role,
        ...details
    }, request);
}

/**
 * Log user update
 * @param {Object} details - Update details (userId, username, changes)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logUserUpdated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.USER_UPDATED, {
        target_user_id: details.targetUserId,
        target_username: details.targetUsername,
        updated_by_user_id: details.updatedByUserId,
        updated_by_username: details.updatedByUsername,
        changes: details.changes,
        ...details
    }, request);
}

/**
 * Log user deletion
 * @param {Object} details - Deletion details (userId, username, deletedBy)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logUserDeleted(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.USER_DELETED, {
        deleted_user_id: details.deletedUserId,
        deleted_username: details.deletedUsername,
        deleted_by_user_id: details.deletedByUserId,
        deleted_by_username: details.deletedByUsername,
        ...details
    }, request);
}

/**
 * Log camera creation
 * @param {Object} details - Creation details (cameraId, cameraName, createdBy)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logCameraCreated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.CAMERA_CREATED, {
        camera_id: details.cameraId,
        camera_name: details.cameraName,
        created_by_user_id: details.createdByUserId,
        created_by_username: details.createdByUsername,
        ...details
    }, request);
}

/**
 * Log camera update
 * @param {Object} details - Update details (cameraId, cameraName, changes)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logCameraUpdated(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.CAMERA_UPDATED, {
        camera_id: details.cameraId,
        camera_name: details.cameraName,
        updated_by_user_id: details.updatedByUserId,
        updated_by_username: details.updatedByUsername,
        changes: details.changes,
        ...details
    }, request);
}

/**
 * Log camera deletion
 * @param {Object} details - Deletion details (cameraId, cameraName, deletedBy)
 * @param {Object} request - Fastify request object (optional)
 * @returns {Object} Log entry
 */
export function logCameraDeleted(details, request = null) {
    return logSecurityEvent(SECURITY_EVENTS.CAMERA_DELETED, {
        camera_id: details.cameraId,
        camera_name: details.cameraName,
        deleted_by_user_id: details.deletedByUserId,
        deleted_by_username: details.deletedByUsername,
        ...details
    }, request);
}


/**
 * Get recent security logs
 * @param {number} limit - Maximum number of logs to return
 * @param {string} eventType - Filter by event type (optional)
 * @returns {Array} Security logs
 */
export function getRecentLogs(limit = 100, eventType = null) {
    try {
        if (eventType) {
            return query(`
                SELECT * FROM security_logs 
                WHERE event_type = ? 
                ORDER BY timestamp DESC 
                LIMIT ?
            `, [eventType, limit]);
        }
        return query(`
            SELECT * FROM security_logs 
            ORDER BY timestamp DESC 
            LIMIT ?
        `, [limit]);
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to get logs:', error.message);
        return [];
    }
}

/**
 * Get logs by IP address
 * @param {string} ipAddress - IP address to filter by
 * @param {number} limit - Maximum number of logs to return
 * @returns {Array} Security logs
 */
export function getLogsByIp(ipAddress, limit = 100) {
    try {
        return query(`
            SELECT * FROM security_logs 
            WHERE ip_address = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `, [ipAddress, limit]);
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to get logs by IP:', error.message);
        return [];
    }
}

/**
 * Get logs by username
 * @param {string} username - Username to filter by
 * @param {number} limit - Maximum number of logs to return
 * @returns {Array} Security logs
 */
export function getLogsByUsername(username, limit = 100) {
    try {
        return query(`
            SELECT * FROM security_logs 
            WHERE username = ? 
            ORDER BY timestamp DESC 
            LIMIT ?
        `, [username, limit]);
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to get logs by username:', error.message);
        return [];
    }
}

/**
 * Get logs within a date range
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @param {string} eventType - Filter by event type (optional)
 * @returns {Array} Security logs
 */
export function getLogsByDateRange(startDate, endDate, eventType = null) {
    try {
        const startIso = startDate.toISOString();
        const endIso = endDate.toISOString();
        
        if (eventType) {
            return query(`
                SELECT * FROM security_logs 
                WHERE timestamp >= ? AND timestamp <= ? AND event_type = ?
                ORDER BY timestamp DESC
            `, [startIso, endIso, eventType]);
        }
        return query(`
            SELECT * FROM security_logs 
            WHERE timestamp >= ? AND timestamp <= ?
            ORDER BY timestamp DESC
        `, [startIso, endIso]);
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to get logs by date range:', error.message);
        return [];
    }
}

/**
 * Get log statistics
 * @param {number} days - Number of days to include in statistics
 * @returns {Object} Statistics object
 */
export function getLogStatistics(days = 7) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - days);
        const cutoffIso = cutoffDate.toISOString();
        
        const stats = query(`
            SELECT event_type, COUNT(*) as count
            FROM security_logs
            WHERE timestamp >= ?
            GROUP BY event_type
            ORDER BY count DESC
        `, [cutoffIso]);
        
        const totalLogs = stats.reduce((sum, s) => sum + s.count, 0);
        
        return {
            period_days: days,
            total_events: totalLogs,
            events_by_type: stats.reduce((acc, s) => {
                acc[s.event_type] = s.count;
                return acc;
            }, {})
        };
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to get statistics:', error.message);
        return { period_days: days, total_events: 0, events_by_type: {} };
    }
}


/**
 * Cleanup old logs (retention: 90 days)
 * Should be called periodically (e.g., daily via cron or scheduled task)
 * @returns {number} Number of deleted logs
 */
export function cleanupOldLogs() {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - LOG_RETENTION_DAYS);
        
        const result = execute(`
            DELETE FROM security_logs 
            WHERE timestamp < ?
        `, [cutoffDate.toISOString()]);
        
        const deletedCount = result.changes || 0;
        
        if (deletedCount > 0) {
            console.log(`[SECURITY_AUDIT] Cleaned up ${deletedCount} logs older than ${LOG_RETENTION_DAYS} days`);
        }
        
        return deletedCount;
    } catch (error) {
        console.warn('[SECURITY_AUDIT] Failed to cleanup logs:', error.message);
        return 0;
    }
}

/**
 * Schedule daily log cleanup
 * Runs cleanup at midnight every day
 * @returns {NodeJS.Timeout} Interval ID for cleanup
 */
let cleanupIntervalId = null;

export function startDailyCleanup() {
    // Run cleanup immediately on start
    cleanupOldLogs();
    
    // Schedule daily cleanup (every 24 hours)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    cleanupIntervalId = setInterval(() => {
        console.log('[SECURITY_AUDIT] Running scheduled log cleanup...');
        cleanupOldLogs();
    }, TWENTY_FOUR_HOURS);
    
    console.log('[SECURITY_AUDIT] Daily log cleanup scheduled');
    return cleanupIntervalId;
}

/**
 * Stop the daily cleanup interval
 */
export function stopDailyCleanup() {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
        console.log('[SECURITY_AUDIT] Daily log cleanup stopped');
    }
}

/**
 * Check if daily cleanup is running
 * @returns {boolean} True if cleanup is scheduled
 */
export function isCleanupRunning() {
    return cleanupIntervalId !== null;
}

export default {
    SECURITY_EVENTS,
    EVENT_TYPES,
    LOG_RETENTION_DAYS,
    generateFingerprint,
    logSecurityEvent,
    logAuthAttempt,
    logRateLimitViolation,
    logApiKeyFailure,
    logApiKeyCreated,
    logApiKeyRevoked,
    logCsrfFailure,
    logAccountLockout,
    logSessionCreated,
    logSessionRefreshed,
    logSessionInvalidated,
    logTokenBlacklisted,
    logFingerprintMismatch,
    logPasswordChanged,
    logPasswordValidationFailed,
    logAdminAction,
    logUserCreated,
    logUserUpdated,
    logUserDeleted,
    logCameraCreated,
    logCameraUpdated,
    logCameraDeleted,
    getRecentLogs,
    getLogsByIp,
    getLogsByUsername,
    getLogsByDateRange,
    getLogStatistics,
    cleanupOldLogs,
    startDailyCleanup,
    stopDailyCleanup,
    isCleanupRunning
};
