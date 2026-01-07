/**
 * Rate Limiter Middleware
 * 
 * Implements sliding window rate limiting to protect against abuse and DoS attacks.
 * 
 * Features:
 * - Sliding window algorithm for accurate rate calculation
 * - Different limits for public (100/min) and auth (30/min) endpoints
 * - Whitelist for health check and stream endpoints
 * - Returns 429 with Retry-After header when exceeded
 * - Logs rate limit violations
 * 
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
 */

import { logRateLimitViolation as auditLogRateLimitViolation } from '../services/securityAuditLogger.js';

/**
 * Rate limiter configuration per endpoint type
 */
export const RATE_LIMIT_CONFIG = {
    // Public endpoints: 100 requests per minute
    public: {
        max: 100,
        window: 60 * 1000 // 60 seconds in ms
    },
    // Auth endpoints: 30 requests per minute
    auth: {
        max: 30,
        window: 60 * 1000 // 60 seconds in ms
    },
    // Admin endpoints: 60 requests per minute
    admin: {
        max: 60,
        window: 60 * 1000 // 60 seconds in ms
    },
    // Whitelisted endpoints (no rate limiting)
    whitelist: [
        '/health',
        '/api/stream',
        '/api/viewer/heartbeat',  // Viewer heartbeat needs frequent calls (every 10s)
        '/hls'                    // HLS proxy - high frequency segment requests
    ],
    // Auth endpoint prefixes
    authPrefixes: [
        '/api/auth'
    ],
    // Admin endpoint prefixes
    adminPrefixes: [
        '/api/admin'
    ]
};

/**
 * In-memory store for rate limiting
 * Structure: Map<key, { timestamps: number[], windowStart: number }>
 */
const rateLimitStore = new Map();

/**
 * Cleanup interval for expired entries (5 minutes)
 */
const CLEANUP_INTERVAL = 5 * 60 * 1000;

/**
 * Start cleanup interval
 */
let cleanupIntervalId = null;

/**
 * Check if URL is whitelisted from rate limiting
 * @param {string} url - Request URL
 * @returns {boolean} True if whitelisted
 */
export function isWhitelisted(url) {
    return RATE_LIMIT_CONFIG.whitelist.some(pattern => 
        url === pattern || url.startsWith(pattern + '/')
    );
}

/**
 * Get endpoint type for rate limiting
 * @param {string} url - Request URL
 * @returns {'public' | 'auth' | 'admin' | 'whitelist'} Endpoint type
 */
export function getEndpointType(url) {
    if (isWhitelisted(url)) {
        return 'whitelist';
    }
    
    if (RATE_LIMIT_CONFIG.authPrefixes.some(prefix => url.startsWith(prefix))) {
        return 'auth';
    }
    
    if (RATE_LIMIT_CONFIG.adminPrefixes.some(prefix => url.startsWith(prefix))) {
        return 'admin';
    }
    
    return 'public';
}

/**
 * Get rate limit configuration for endpoint type
 * @param {string} endpointType - Endpoint type
 * @returns {{ max: number, window: number } | null} Rate limit config or null for whitelist
 */
export function getRateLimitForType(endpointType) {
    if (endpointType === 'whitelist') {
        return null;
    }
    return RATE_LIMIT_CONFIG[endpointType] || RATE_LIMIT_CONFIG.public;
}

/**
 * Generate rate limit key from IP and endpoint type
 * @param {string} ip - Client IP address
 * @param {string} endpointType - Endpoint type
 * @returns {string} Rate limit key
 */
export function generateRateLimitKey(ip, endpointType) {
    return `${ip}:${endpointType}`;
}

/**
 * Sliding window rate limiter
 * 
 * Uses a sliding window algorithm that tracks individual request timestamps
 * and counts requests within the current window.
 * 
 * @param {string} key - Unique identifier (IP + endpoint type)
 * @param {number} limit - Max requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{ allowed: boolean, remaining: number, resetAt: number, retryAfter: number }}
 */
export function checkRateLimit(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get or create entry
    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { timestamps: [] };
        rateLimitStore.set(key, entry);
    }
    
    // Remove timestamps outside the current window (sliding window)
    entry.timestamps = entry.timestamps.filter(ts => ts > windowStart);
    
    // Count requests in current window
    const requestCount = entry.timestamps.length;
    const remaining = Math.max(0, limit - requestCount);
    
    // Calculate when the oldest request will expire
    const oldestTimestamp = entry.timestamps[0] || now;
    const resetAt = oldestTimestamp + windowMs;
    const retryAfter = Math.ceil((resetAt - now) / 1000);
    
    // Check if limit exceeded
    if (requestCount >= limit) {
        return {
            allowed: false,
            remaining: 0,
            resetAt,
            retryAfter: Math.max(1, retryAfter)
        };
    }
    
    // Add current request timestamp
    entry.timestamps.push(now);
    
    return {
        allowed: true,
        remaining: remaining - 1,
        resetAt: now + windowMs,
        retryAfter: 0
    };
}

/**
 * Reset rate limit for a specific key
 * @param {string} key - Rate limit key
 */
export function resetRateLimit(key) {
    rateLimitStore.delete(key);
}

/**
 * Clear all rate limit entries
 */
export function clearAllRateLimits() {
    rateLimitStore.clear();
}

/**
 * Get current rate limit status for a key
 * @param {string} key - Rate limit key
 * @param {number} limit - Max requests allowed
 * @param {number} windowMs - Time window in milliseconds
 * @returns {{ count: number, remaining: number }}
 */
export function getRateLimitStatus(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;
    
    const entry = rateLimitStore.get(key);
    if (!entry) {
        return { count: 0, remaining: limit };
    }
    
    // Count requests in current window
    const validTimestamps = entry.timestamps.filter(ts => ts > windowStart);
    const count = validTimestamps.length;
    
    return {
        count,
        remaining: Math.max(0, limit - count)
    };
}

/**
 * Cleanup expired entries from the store
 */
export function cleanupExpiredEntries() {
    const now = Date.now();
    const maxWindow = Math.max(
        RATE_LIMIT_CONFIG.public.window,
        RATE_LIMIT_CONFIG.auth.window,
        RATE_LIMIT_CONFIG.admin.window
    );
    const cutoff = now - maxWindow;
    
    for (const [key, entry] of rateLimitStore.entries()) {
        // Remove timestamps older than the max window
        entry.timestamps = entry.timestamps.filter(ts => ts > cutoff);
        
        // Remove entry if no timestamps remain
        if (entry.timestamps.length === 0) {
            rateLimitStore.delete(key);
        }
    }
}

/**
 * Start the cleanup interval
 */
export function startCleanupInterval() {
    if (!cleanupIntervalId) {
        cleanupIntervalId = setInterval(cleanupExpiredEntries, CLEANUP_INTERVAL);
    }
}

/**
 * Stop the cleanup interval
 */
export function stopCleanupInterval() {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
    }
}

/**
 * Log rate limit violation
 * @param {Object} details - Violation details
 * @param {Object} request - Fastify request object (optional)
 */
export function logRateLimitViolation(details, request = null) {
    const logEntry = {
        event_type: 'RATE_LIMIT_EXCEEDED',
        timestamp: new Date().toISOString(),
        ip_address: details.ip,
        endpoint: details.url,
        endpoint_type: details.endpointType,
        limit: details.limit,
        window_seconds: details.windowSeconds,
        retry_after: details.retryAfter
    };
    
    // Log to console
    console.warn('[RATE_LIMIT]', JSON.stringify(logEntry));
    
    // Log to security audit logger
    try {
        auditLogRateLimitViolation(details, request);
    } catch (error) {
        // Silently fail if audit logger has issues
        console.warn('[RATE_LIMIT] Audit log failed:', error.message);
    }
    
    return logEntry;
}

/**
 * Rate limiter middleware for Fastify
 * 
 * Implements sliding window rate limiting with different limits per endpoint type.
 * 
 * @param {FastifyInstance} fastify - Fastify instance
 * @param {Object} options - Plugin options
 */
export async function rateLimiterMiddleware(fastify, options = {}) {
    // Start cleanup interval
    startCleanupInterval();
    
    // Add rate limiting hook
    fastify.addHook('onRequest', async (request, reply) => {
        const url = request.url || '';
        const ip = request.ip || request.headers['x-forwarded-for'] || 'unknown';
        
        // Get endpoint type
        const endpointType = getEndpointType(url);
        
        // Skip rate limiting for whitelisted endpoints
        if (endpointType === 'whitelist') {
            return;
        }
        
        // Get rate limit config for this endpoint type
        const config = getRateLimitForType(endpointType);
        if (!config) {
            return;
        }
        
        // Generate rate limit key
        const key = generateRateLimitKey(ip, endpointType);
        
        // Check rate limit
        const result = checkRateLimit(key, config.max, config.window);
        
        // Add rate limit headers to response
        reply.header('X-RateLimit-Limit', config.max);
        reply.header('X-RateLimit-Remaining', result.remaining);
        reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));
        
        // If rate limit exceeded, return 429
        if (!result.allowed) {
            // Log the violation with request object for fingerprinting
            logRateLimitViolation({
                ip,
                url,
                endpointType,
                limit: config.max,
                windowSeconds: config.window / 1000,
                retryAfter: result.retryAfter
            }, request);
            
            reply.header('Retry-After', result.retryAfter);
            reply.code(429).send({
                success: false,
                message: 'Too many requests. Please try again later.',
                retryAfter: result.retryAfter
            });
            return reply;
        }
    });
    
    // Cleanup on server close
    fastify.addHook('onClose', async () => {
        stopCleanupInterval();
    });
}

export default rateLimiterMiddleware;
