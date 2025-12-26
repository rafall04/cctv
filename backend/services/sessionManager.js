import crypto from 'crypto';
import { query, queryOne, execute } from '../database/database.js';
import { config } from '../config/config.js';
import { 
    logSessionInvalidated, 
    logTokenBlacklisted 
} from './securityAuditLogger.js';

/**
 * Session Manager Service
 * Handles enhanced session management with fingerprint binding,
 * token blacklisting, and absolute session timeout.
 * 
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

// Session configuration
const SESSION_CONFIG = {
    accessTokenExpiry: '1h',           // 1 hour for access token
    refreshTokenExpiry: '7d',          // 7 days for refresh token
    absoluteTimeout: 24 * 60 * 60 * 1000, // 24 hours absolute timeout
    fingerprintFields: ['ip', 'userAgent']
};

/**
 * Generate client fingerprint from request
 * Creates SHA256 hash of IP + User-Agent
 * @param {Object} request - Fastify request object
 * @returns {string} SHA256 hash of fingerprint
 */
export function generateFingerprint(request) {
    const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const data = `${ip}:${userAgent}`;
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Parse duration string to milliseconds
 * @param {string} duration - Duration string (e.g., '1h', '7d')
 * @returns {number} Duration in milliseconds
 */
function parseDuration(duration) {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match) return 3600000; // Default 1 hour
    
    const value = parseInt(match[1], 10);
    const unit = match[2];
    
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: return 3600000;
    }
}

/**
 * Create access token with fingerprint binding
 * @param {Object} fastify - Fastify instance with jwt
 * @param {Object} user - User data
 * @param {string} fingerprint - Client fingerprint
 * @param {number} sessionCreatedAt - Session creation timestamp
 * @returns {string} JWT access token
 */
export function createAccessToken(fastify, user, fingerprint, sessionCreatedAt) {
    return fastify.jwt.sign({
        id: user.id,
        username: user.username,
        role: user.role,
        fingerprint: fingerprint,
        sessionCreatedAt: sessionCreatedAt,
        type: 'access'
    }, {
        expiresIn: SESSION_CONFIG.accessTokenExpiry
    });
}

/**
 * Create refresh token with fingerprint binding
 * @param {Object} fastify - Fastify instance with jwt
 * @param {Object} user - User data
 * @param {string} fingerprint - Client fingerprint
 * @param {number} sessionCreatedAt - Session creation timestamp
 * @returns {string} JWT refresh token
 */
export function createRefreshToken(fastify, user, fingerprint, sessionCreatedAt) {
    return fastify.jwt.sign({
        id: user.id,
        username: user.username,
        fingerprint: fingerprint,
        sessionCreatedAt: sessionCreatedAt,
        type: 'refresh'
    }, {
        expiresIn: SESSION_CONFIG.refreshTokenExpiry
    });
}

/**
 * Create token pair (access + refresh)
 * @param {Object} fastify - Fastify instance with jwt
 * @param {Object} user - User data
 * @param {string} fingerprint - Client fingerprint
 * @returns {Object} { accessToken, refreshToken, sessionCreatedAt }
 */
export function createTokenPair(fastify, user, fingerprint) {
    const sessionCreatedAt = Date.now();
    
    const accessToken = createAccessToken(fastify, user, fingerprint, sessionCreatedAt);
    const refreshToken = createRefreshToken(fastify, user, fingerprint, sessionCreatedAt);
    
    return {
        accessToken,
        refreshToken,
        sessionCreatedAt
    };
}


/**
 * Validate fingerprint from token against current request
 * @param {Object} tokenPayload - Decoded token payload
 * @param {string} currentFingerprint - Current request fingerprint
 * @returns {boolean} True if fingerprints match
 */
export function validateFingerprint(tokenPayload, currentFingerprint) {
    if (!tokenPayload || !tokenPayload.fingerprint) {
        return false;
    }
    return tokenPayload.fingerprint === currentFingerprint;
}

/**
 * Check if session has exceeded absolute timeout (24 hours)
 * @param {Object} tokenPayload - Decoded token payload
 * @returns {boolean} True if session has timed out
 */
export function isSessionExpired(tokenPayload) {
    if (!tokenPayload || !tokenPayload.sessionCreatedAt) {
        return true;
    }
    
    const sessionAge = Date.now() - tokenPayload.sessionCreatedAt;
    return sessionAge > SESSION_CONFIG.absoluteTimeout;
}

/**
 * Hash a token for storage in blacklist
 * @param {string} token - JWT token
 * @returns {string} SHA256 hash of token
 */
export function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Add token to blacklist
 * @param {string} token - Token to blacklist
 * @param {number} userId - User ID (optional)
 * @param {string} reason - Reason for blacklisting
 * @param {Date} expiresAt - When the blacklist entry expires
 * @param {Object} request - Fastify request for logging (optional)
 */
export function blacklistToken(token, userId = null, reason = 'logout', expiresAt = null, request = null) {
    const tokenHash = hashToken(token);
    
    // Default expiry: 7 days from now (matches refresh token expiry)
    const expiry = expiresAt || new Date(Date.now() + parseDuration(SESSION_CONFIG.refreshTokenExpiry));
    
    try {
        execute(
            `INSERT OR REPLACE INTO token_blacklist (token_hash, user_id, reason, expires_at) 
             VALUES (?, ?, ?, ?)`,
            [tokenHash, userId, reason, expiry.toISOString()]
        );
        
        // Log token blacklisting
        logTokenBlacklisted({
            userId: userId,
            reason: reason,
            tokenType: reason === 'token_rotation' ? 'rotation' : 'manual'
        }, request);
        
        return true;
    } catch (error) {
        console.error('Error blacklisting token:', error);
        return false;
    }
}

/**
 * Check if token is blacklisted
 * @param {string} token - Token to check
 * @returns {boolean} True if token is blacklisted
 */
export function isTokenBlacklisted(token) {
    const tokenHash = hashToken(token);
    
    try {
        const entry = queryOne(
            `SELECT id FROM token_blacklist 
             WHERE token_hash = ? AND expires_at > datetime('now')`,
            [tokenHash]
        );
        return !!entry;
    } catch (error) {
        console.error('Error checking token blacklist:', error);
        return false;
    }
}

/**
 * Blacklist all tokens for a user (used on password change)
 * @param {number} userId - User ID
 * @param {string} reason - Reason for blacklisting
 * @param {Object} request - Fastify request for logging (optional)
 * @returns {boolean} Success status
 */
export function blacklistAllUserTokens(userId, reason = 'password_change', request = null) {
    try {
        // Track the invalidation time in the user record
        // All tokens issued before this time will be considered invalid
        execute(
            `UPDATE users SET tokens_invalidated_at = ? WHERE id = ?`,
            [new Date().toISOString(), userId]
        );
        
        // Log session invalidation
        logSessionInvalidated({
            userId: userId,
            reason: reason
        }, request);
        
        return true;
    } catch (error) {
        console.error('Error invalidating user tokens:', error);
        return false;
    }
}

/**
 * Check if token was issued before user's tokens were invalidated
 * @param {Object} tokenPayload - Decoded token payload
 * @param {number} userId - User ID
 * @returns {boolean} True if token is invalidated
 */
export function isTokenInvalidatedByUser(tokenPayload, userId) {
    try {
        const user = queryOne(
            'SELECT tokens_invalidated_at FROM users WHERE id = ?',
            [userId]
        );
        
        if (!user || !user.tokens_invalidated_at) {
            return false;
        }
        
        const invalidatedAt = new Date(user.tokens_invalidated_at).getTime();
        const tokenIssuedAt = tokenPayload.sessionCreatedAt || (tokenPayload.iat * 1000);
        
        // Token is invalid if it was issued before the invalidation time
        return tokenIssuedAt < invalidatedAt;
    } catch (error) {
        console.error('Error checking token invalidation:', error);
        return false;
    }
}

/**
 * Invalidate all user sessions on password change
 * This is called when a user changes their password
 * @param {number} userId - User ID
 * @param {string} currentToken - Current token to exclude from invalidation (optional)
 * @returns {boolean} Success status
 */
export function invalidateUserSessionsOnPasswordChange(userId, currentToken = null) {
    try {
        // Blacklist all user tokens
        const success = blacklistAllUserTokens(userId, 'password_change');
        
        if (success) {
            console.log(`All sessions invalidated for user ${userId} due to password change`);
        }
        
        return success;
    } catch (error) {
        console.error('Error invalidating sessions on password change:', error);
        return false;
    }
}

/**
 * Cleanup expired blacklist entries
 * Should be called periodically (e.g., daily)
 */
export function cleanupExpiredBlacklistEntries() {
    try {
        const result = execute(
            `DELETE FROM token_blacklist WHERE expires_at < datetime('now')`
        );
        console.log(`Cleaned up ${result.changes} expired blacklist entries`);
        return result.changes;
    } catch (error) {
        console.error('Error cleaning up blacklist:', error);
        return 0;
    }
}

/**
 * Rotate tokens - issue new pair and blacklist old ones
 * @param {Object} fastify - Fastify instance
 * @param {string} oldAccessToken - Old access token to blacklist
 * @param {string} oldRefreshToken - Old refresh token to blacklist
 * @param {Object} user - User data
 * @param {string} fingerprint - Client fingerprint
 * @returns {Object} New token pair
 */
export function rotateTokens(fastify, oldAccessToken, oldRefreshToken, user, fingerprint) {
    // Blacklist old tokens
    if (oldAccessToken) {
        blacklistToken(oldAccessToken, user.id, 'token_rotation');
    }
    if (oldRefreshToken) {
        blacklistToken(oldRefreshToken, user.id, 'token_rotation');
    }
    
    // Create new token pair
    return createTokenPair(fastify, user, fingerprint);
}

/**
 * Get session configuration
 * @returns {Object} Session configuration
 */
export function getSessionConfig() {
    return { ...SESSION_CONFIG };
}

export default {
    generateFingerprint,
    createTokenPair,
    createAccessToken,
    createRefreshToken,
    validateFingerprint,
    isSessionExpired,
    hashToken,
    blacklistToken,
    isTokenBlacklisted,
    blacklistAllUserTokens,
    isTokenInvalidatedByUser,
    invalidateUserSessionsOnPasswordChange,
    cleanupExpiredBlacklistEntries,
    rotateTokens,
    getSessionConfig
};
