import {
    generateFingerprint,
    validateFingerprint,
    isSessionExpired,
    isTokenBlacklisted
} from '../services/sessionManager.js';
import { 
    logSecurityEvent, 
    logFingerprintMismatch,
    logSessionInvalidated,
    SECURITY_EVENTS 
} from '../services/securityAuditLogger.js';

/**
 * Fingerprint Validation Middleware
 * Validates that the token fingerprint matches the current request fingerprint.
 * Also checks for absolute session timeout and token blacklist.
 * 
 * Requirements: 4.3, 4.4, 4.8
 */

/**
 * Enhanced auth middleware with fingerprint validation
 * @param {Object} request - Fastify request
 * @param {Object} reply - Fastify reply
 */
export async function fingerprintAuthMiddleware(request, reply) {
    try {
        let token = null;
        let decoded = null;

        // Try to get token from Authorization header first
        const authHeader = request.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        }

        // Fall back to cookie
        if (!token) {
            token = request.cookies.token;
        }

        if (!token) {
            return reply.code(401).send({
                success: false,
                message: 'Unauthorized - No token provided',
            });
        }

        // Check if token is blacklisted
        if (isTokenBlacklisted(token)) {
            logSessionInvalidated({
                reason: 'Token blacklisted',
                ip_address: request.ip
            }, request);

            return reply.code(401).send({
                success: false,
                message: 'Unauthorized - Token has been invalidated',
            });
        }

        // Verify JWT
        try {
            decoded = request.server.jwt.verify(token);
        } catch (jwtError) {
            return reply.code(401).send({
                success: false,
                message: 'Unauthorized - Invalid or expired token',
            });
        }

        // Check absolute session timeout (24 hours)
        if (isSessionExpired(decoded)) {
            logSessionInvalidated({
                reason: 'Absolute session timeout exceeded',
                username: decoded.username,
                userId: decoded.id,
                sessionAge: Date.now() - decoded.sessionCreatedAt
            }, request);

            return reply.code(401).send({
                success: false,
                message: 'Session expired - Please login again',
            });
        }

        // Validate fingerprint
        const currentFingerprint = generateFingerprint(request);
        
        if (!validateFingerprint(decoded, currentFingerprint)) {
            logFingerprintMismatch({
                userId: decoded.id,
                username: decoded.username,
                expectedFingerprint: decoded.fingerprint,
                actualFingerprint: currentFingerprint
            }, request);

            return reply.code(401).send({
                success: false,
                message: 'Session invalid - Please login again',
            });
        }

        // Set user on request
        request.user = decoded;
        request.token = token;

    } catch (error) {
        console.error('Fingerprint auth middleware error:', error);
        return reply.code(500).send({
            success: false,
            message: 'Internal server error',
        });
    }
}

/**
 * Lightweight fingerprint check (for use after basic auth)
 * Use this when you want to add fingerprint validation to existing auth flow
 * @param {Object} request - Fastify request
 * @param {Object} reply - Fastify reply
 */
export async function validateRequestFingerprint(request, reply) {
    try {
        // Skip if no user (not authenticated)
        if (!request.user) {
            return;
        }

        // Skip if token doesn't have fingerprint (legacy tokens)
        if (!request.user.fingerprint) {
            return;
        }

        const currentFingerprint = generateFingerprint(request);
        
        if (!validateFingerprint(request.user, currentFingerprint)) {
            logFingerprintMismatch({
                userId: request.user.id,
                username: request.user.username,
                expectedFingerprint: request.user.fingerprint,
                actualFingerprint: currentFingerprint
            }, request);

            return reply.code(401).send({
                success: false,
                message: 'Session invalid - Please login again',
            });
        }
    } catch (error) {
        console.error('Fingerprint validation error:', error);
        // Don't fail the request on validation error, just log it
    }
}

export default {
    fingerprintAuthMiddleware,
    validateRequestFingerprint
};
