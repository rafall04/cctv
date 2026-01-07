/**
 * CSRF Protection Middleware
 * 
 * Implements CSRF token generation and validation to prevent
 * Cross-Site Request Forgery attacks on state-changing requests.
 * 
 * Requirements: 1.6, 1.7
 */

import crypto from 'crypto';
import { logCsrfFailure } from '../services/securityAuditLogger.js';

/**
 * CSRF token configuration
 */
export const CSRF_CONFIG = {
    tokenLength: 32,                    // 32 bytes = 64 hex characters
    headerName: 'X-CSRF-Token',         // Header name for CSRF token
    cookieName: 'csrf_token',           // Cookie name for CSRF token
    expirationMinutes: 60,              // Token expiration in minutes
    cookieOptions: {
        httpOnly: true,                 // Prevent JavaScript access
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',             // Strict same-site policy
        path: '/'
    }
};

/**
 * State-changing HTTP methods that require CSRF validation
 */
export const STATE_CHANGING_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

/**
 * Endpoints that skip CSRF validation (API key-only endpoints)
 * These are typically machine-to-machine API calls
 */
export const CSRF_SKIP_ENDPOINTS = [
    '/api/stream',                      // Stream endpoints use API key only
    '/api/viewer/start',                // Viewer tracking - public endpoint
    '/api/viewer/heartbeat',            // Viewer tracking - public endpoint
    '/api/viewer/stop',                 // Viewer tracking - public endpoint
    '/health',                          // Health check endpoint
    '/hls'                              // HLS proxy - public streaming endpoint
];

/**
 * Generate a cryptographically secure CSRF token
 * @returns {string} 64-character hex string (32 bytes)
 */
export function generateCsrfToken() {
    return crypto.randomBytes(CSRF_CONFIG.tokenLength).toString('hex');
}

/**
 * Timing-safe comparison of two strings
 * Prevents timing attacks by ensuring constant-time comparison
 * @param {string} a - First string
 * @param {string} b - Second string
 * @returns {boolean} True if strings are equal
 */
export function timingSafeEqual(a, b) {
    if (!a || !b) return false;
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    
    // Convert to buffers for timing-safe comparison
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    
    // If lengths differ, still do comparison to prevent timing leak
    if (bufA.length !== bufB.length) {
        // Compare with itself to maintain constant time
        crypto.timingSafeEqual(bufA, bufA);
        return false;
    }
    
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Check if a request method is state-changing
 * @param {string} method - HTTP method
 * @returns {boolean} True if state-changing
 */
export function isStateChangingMethod(method) {
    return STATE_CHANGING_METHODS.includes(method?.toUpperCase());
}

/**
 * Check if an endpoint should skip CSRF validation
 * @param {string} url - Request URL
 * @returns {boolean} True if should skip
 */
export function shouldSkipCsrf(url) {
    if (!url) return false;
    return CSRF_SKIP_ENDPOINTS.some(endpoint => url.startsWith(endpoint));
}

/**
 * Validate CSRF token from request
 * Compares header token against cookie token using timing-safe comparison
 * @param {Object} request - Fastify request object
 * @returns {Object} { valid: boolean, reason?: string }
 */
export function validateCsrfToken(request) {
    // Get token from header
    const headerToken = request.headers[CSRF_CONFIG.headerName.toLowerCase()];
    
    // Get token from cookie
    const cookieToken = request.cookies?.[CSRF_CONFIG.cookieName];
    
    // Check if header token exists
    if (!headerToken) {
        return { valid: false, reason: 'Missing CSRF token in header' };
    }
    
    // Check if cookie token exists
    if (!cookieToken) {
        return { valid: false, reason: 'Missing CSRF token in cookie' };
    }
    
    // Validate token format (should be 64 hex characters)
    if (!/^[a-f0-9]{64}$/i.test(headerToken)) {
        return { valid: false, reason: 'Invalid CSRF token format in header' };
    }
    
    if (!/^[a-f0-9]{64}$/i.test(cookieToken)) {
        return { valid: false, reason: 'Invalid CSRF token format in cookie' };
    }
    
    // Compare tokens using timing-safe comparison
    if (!timingSafeEqual(headerToken, cookieToken)) {
        return { valid: false, reason: 'CSRF token mismatch' };
    }
    
    return { valid: true };
}

/**
 * Set CSRF token cookie on response
 * @param {Object} reply - Fastify reply object
 * @param {string} token - CSRF token
 */
export function setCsrfCookie(reply, token) {
    reply.setCookie(CSRF_CONFIG.cookieName, token, {
        ...CSRF_CONFIG.cookieOptions,
        maxAge: CSRF_CONFIG.expirationMinutes * 60 // Convert to seconds
    });
}

/**
 * Clear CSRF token cookie
 * @param {Object} reply - Fastify reply object
 */
export function clearCsrfCookie(reply) {
    reply.clearCookie(CSRF_CONFIG.cookieName, {
        path: CSRF_CONFIG.cookieOptions.path
    });
}


/**
 * CSRF Protection Middleware for Fastify
 * 
 * Validates CSRF tokens for state-changing requests (POST, PUT, DELETE, PATCH).
 * Skips validation for API key-only endpoints and non-state-changing methods.
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
export async function csrfMiddleware(fastify, options = {}) {
    fastify.addHook('preHandler', async (request, reply) => {
        const method = request.method?.toUpperCase();
        const url = request.url || '';
        
        // Skip CSRF validation for non-state-changing methods
        if (!isStateChangingMethod(method)) {
            return;
        }
        
        // Skip CSRF validation for whitelisted endpoints
        if (shouldSkipCsrf(url)) {
            return;
        }
        
        // Skip CSRF validation for login endpoint (no session yet)
        if (url.startsWith('/api/auth/login')) {
            return;
        }
        
        // Validate CSRF token
        const validation = validateCsrfToken(request);
        
        if (!validation.valid) {
            // Log CSRF failure
            logCsrfFailure({
                reason: validation.reason,
                method: method,
                endpoint: url,
                ip_address: request.ip,
                user_agent: request.headers?.['user-agent']
            }, request);
            
            // Return 403 Forbidden
            return reply.code(403).send({
                success: false,
                message: 'CSRF validation failed',
                error: 'Forbidden'
            });
        }
    });
}

/**
 * Create a standalone CSRF validation function for use in specific routes
 * @param {Object} request - Fastify request object
 * @param {Object} reply - Fastify reply object
 * @returns {boolean} True if validation passed, false if response was sent
 */
export async function validateCsrfMiddleware(request, reply) {
    const method = request.method?.toUpperCase();
    const url = request.url || '';
    
    // Skip for non-state-changing methods
    if (!isStateChangingMethod(method)) {
        return true;
    }
    
    // Skip for whitelisted endpoints
    if (shouldSkipCsrf(url)) {
        return true;
    }
    
    // Skip for login endpoint
    if (url.startsWith('/api/auth/login')) {
        return true;
    }
    
    const validation = validateCsrfToken(request);
    
    if (!validation.valid) {
        logCsrfFailure({
            reason: validation.reason,
            method: method,
            endpoint: url,
            ip_address: request.ip,
            user_agent: request.headers?.['user-agent']
        }, request);
        
        reply.code(403).send({
            success: false,
            message: 'CSRF validation failed',
            error: 'Forbidden'
        });
        return false;
    }
    
    return true;
}

export default {
    CSRF_CONFIG,
    STATE_CHANGING_METHODS,
    CSRF_SKIP_ENDPOINTS,
    generateCsrfToken,
    timingSafeEqual,
    isStateChangingMethod,
    shouldSkipCsrf,
    validateCsrfToken,
    setCsrfCookie,
    clearCsrfCookie,
    csrfMiddleware,
    validateCsrfMiddleware
};
