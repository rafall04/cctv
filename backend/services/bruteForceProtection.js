/**
 * Brute Force Protection Service
 * 
 * Tracks failed login attempts and implements account lockout mechanism.
 * 
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

import { execute, query, queryOne } from '../database/database.js';
import { logAccountLockout, logAuthAttempt } from './securityAuditLogger.js';

/**
 * Brute force protection configuration
 */
export const BRUTE_FORCE_CONFIG = {
    maxAttempts: {
        username: 5,    // Per username
        ip: 10          // Per IP address
    },
    lockoutDuration: {
        username: 30 * 60 * 1000,  // 30 minutes in ms
        ip: 60 * 60 * 1000         // 1 hour in ms
    },
    trackingWindow: 15 * 60 * 1000, // 15 minutes in ms
    progressiveDelay: [1000, 2000, 4000, 8000] // ms delays
};

/**
 * Track a failed login attempt
 * @param {string} username - Attempted username
 * @param {string} ip - Client IP address
 * @returns {Object} { usernameAttempts, ipAttempts }
 */
export function trackFailedAttempt(username, ip) {
    const now = new Date().toISOString();
    
    // Track by username
    if (username) {
        execute(`
            INSERT INTO login_attempts (identifier, identifier_type, attempt_time, success)
            VALUES (?, 'username', ?, 0)
        `, [username, now]);
    }
    
    // Track by IP
    if (ip) {
        execute(`
            INSERT INTO login_attempts (identifier, identifier_type, attempt_time, success)
            VALUES (?, 'ip', ?, 0)
        `, [ip, now]);
    }
    
    // Get current attempt counts
    const usernameAttempts = username ? getFailedAttemptCount(username, 'username') : 0;
    const ipAttempts = ip ? getFailedAttemptCount(ip, 'ip') : 0;
    
    return { usernameAttempts, ipAttempts };
}

/**
 * Track a successful login (resets counters)
 * @param {string} username - Username that logged in
 * @param {string} ip - Client IP address
 */
export function trackSuccessfulLogin(username, ip) {
    const now = new Date().toISOString();
    
    // Record successful attempt
    if (username) {
        execute(`
            INSERT INTO login_attempts (identifier, identifier_type, attempt_time, success)
            VALUES (?, 'username', ?, 1)
        `, [username, now]);
    }
    
    // Clear failed attempts for this username within tracking window
    if (username) {
        clearFailedAttempts(username, 'username');
    }
}

/**
 * Get count of failed attempts within tracking window
 * @param {string} identifier - Username or IP
 * @param {string} identifierType - 'username' or 'ip'
 * @returns {number} Number of failed attempts
 */
export function getFailedAttemptCount(identifier, identifierType) {
    const windowStart = new Date(Date.now() - BRUTE_FORCE_CONFIG.trackingWindow).toISOString();
    
    const result = queryOne(`
        SELECT COUNT(*) as count FROM login_attempts
        WHERE identifier = ? 
        AND identifier_type = ?
        AND attempt_time > ?
        AND success = 0
    `, [identifier, identifierType, windowStart]);
    
    return result?.count || 0;
}

/**
 * Clear failed attempts for an identifier
 * @param {string} identifier - Username or IP
 * @param {string} identifierType - 'username' or 'ip'
 */
export function clearFailedAttempts(identifier, identifierType) {
    execute(`
        DELETE FROM login_attempts
        WHERE identifier = ?
        AND identifier_type = ?
        AND success = 0
    `, [identifier, identifierType]);
}

/**
 * Clean up old login attempts (older than tracking window)
 * @returns {number} Number of deleted records
 */
export function cleanupOldAttempts() {
    const cutoff = new Date(Date.now() - BRUTE_FORCE_CONFIG.trackingWindow * 2).toISOString();
    
    const result = execute(`
        DELETE FROM login_attempts
        WHERE attempt_time < ?
    `, [cutoff]);
    
    return result.changes || 0;
}


/**
 * Check if an account or IP is locked out
 * @param {string} username - Username to check
 * @param {string} ip - IP address to check
 * @returns {Object} { locked: boolean, reason: string, unlockAt: Date|null, lockType: string|null }
 */
export function checkLockout(username, ip) {
    // Check username lockout (5 failed attempts = 30 min lockout)
    if (username) {
        const usernameAttempts = getFailedAttemptCount(username, 'username');
        if (usernameAttempts >= BRUTE_FORCE_CONFIG.maxAttempts.username) {
            const unlockAt = getUnlockTime(username, 'username');
            if (unlockAt && unlockAt > new Date()) {
                return {
                    locked: true,
                    reason: 'Account temporarily locked due to too many failed attempts',
                    unlockAt,
                    lockType: 'username'
                };
            }
        }
    }
    
    // Check IP lockout (10 failed attempts = 1 hour lockout)
    if (ip) {
        const ipAttempts = getFailedAttemptCount(ip, 'ip');
        if (ipAttempts >= BRUTE_FORCE_CONFIG.maxAttempts.ip) {
            const unlockAt = getUnlockTime(ip, 'ip');
            if (unlockAt && unlockAt > new Date()) {
                return {
                    locked: true,
                    reason: 'IP address temporarily blocked due to too many failed attempts',
                    unlockAt,
                    lockType: 'ip'
                };
            }
        }
    }
    
    return {
        locked: false,
        reason: null,
        unlockAt: null,
        lockType: null
    };
}

/**
 * Get the unlock time for a locked identifier
 * @param {string} identifier - Username or IP
 * @param {string} identifierType - 'username' or 'ip'
 * @returns {Date|null} Unlock time or null if not locked
 */
export function getUnlockTime(identifier, identifierType) {
    // Get the most recent failed attempt
    const lastAttempt = queryOne(`
        SELECT attempt_time FROM login_attempts
        WHERE identifier = ?
        AND identifier_type = ?
        AND success = 0
        ORDER BY attempt_time DESC
        LIMIT 1
    `, [identifier, identifierType]);
    
    if (!lastAttempt) return null;
    
    const lastAttemptTime = new Date(lastAttempt.attempt_time);
    const lockoutDuration = identifierType === 'username' 
        ? BRUTE_FORCE_CONFIG.lockoutDuration.username 
        : BRUTE_FORCE_CONFIG.lockoutDuration.ip;
    
    return new Date(lastAttemptTime.getTime() + lockoutDuration);
}

/**
 * Check if lockout threshold is reached and trigger lockout
 * @param {string} username - Username
 * @param {string} ip - IP address
 * @param {Object} request - Fastify request for logging
 * @returns {Object} { usernameLocked: boolean, ipLocked: boolean }
 */
export function checkAndTriggerLockout(username, ip, request = null) {
    const result = { usernameLocked: false, ipLocked: false };
    
    // Check username threshold
    if (username) {
        const usernameAttempts = getFailedAttemptCount(username, 'username');
        if (usernameAttempts >= BRUTE_FORCE_CONFIG.maxAttempts.username) {
            result.usernameLocked = true;
            logAccountLockout({
                username,
                lockType: 'username',
                attempts: usernameAttempts,
                duration_minutes: BRUTE_FORCE_CONFIG.lockoutDuration.username / 60000
            }, request);
        }
    }
    
    // Check IP threshold
    if (ip) {
        const ipAttempts = getFailedAttemptCount(ip, 'ip');
        if (ipAttempts >= BRUTE_FORCE_CONFIG.maxAttempts.ip) {
            result.ipLocked = true;
            logAccountLockout({
                ip_address: ip,
                lockType: 'ip',
                attempts: ipAttempts,
                duration_minutes: BRUTE_FORCE_CONFIG.lockoutDuration.ip / 60000
            }, request);
        }
    }
    
    return result;
}

/**
 * Get remaining attempts before lockout
 * @param {string} username - Username
 * @param {string} ip - IP address
 * @returns {Object} { usernameRemaining: number, ipRemaining: number }
 */
export function getRemainingAttempts(username, ip) {
    const usernameAttempts = username ? getFailedAttemptCount(username, 'username') : 0;
    const ipAttempts = ip ? getFailedAttemptCount(ip, 'ip') : 0;
    
    return {
        usernameRemaining: Math.max(0, BRUTE_FORCE_CONFIG.maxAttempts.username - usernameAttempts),
        ipRemaining: Math.max(0, BRUTE_FORCE_CONFIG.maxAttempts.ip - ipAttempts)
    };
}


/**
 * Get progressive delay based on attempt count
 * @param {number} attemptCount - Current attempt number (1-based)
 * @returns {number} Delay in milliseconds
 */
export function getProgressiveDelay(attemptCount) {
    if (attemptCount <= 0) return 0;
    
    const delays = BRUTE_FORCE_CONFIG.progressiveDelay;
    const index = Math.min(attemptCount - 1, delays.length - 1);
    return delays[index];
}

/**
 * Apply progressive delay before responding
 * @param {number} attemptCount - Current attempt number
 * @returns {Promise<void>} Resolves after delay
 */
export function applyProgressiveDelay(attemptCount) {
    const delay = getProgressiveDelay(attemptCount);
    if (delay <= 0) return Promise.resolve();
    
    return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Get current attempt count for calculating delay
 * @param {string} username - Username
 * @param {string} ip - IP address
 * @returns {number} Higher of username or IP attempt counts
 */
export function getCurrentAttemptCount(username, ip) {
    const usernameAttempts = username ? getFailedAttemptCount(username, 'username') : 0;
    const ipAttempts = ip ? getFailedAttemptCount(ip, 'ip') : 0;
    
    return Math.max(usernameAttempts, ipAttempts);
}

export default {
    BRUTE_FORCE_CONFIG,
    trackFailedAttempt,
    trackSuccessfulLogin,
    getFailedAttemptCount,
    clearFailedAttempts,
    cleanupOldAttempts,
    checkLockout,
    getUnlockTime,
    checkAndTriggerLockout,
    getRemainingAttempts,
    getProgressiveDelay,
    applyProgressiveDelay,
    getCurrentAttemptCount
};
