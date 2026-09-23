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

import fp from 'fastify-plugin';
import { config } from '../config/config.js';
import { getSecuritySettings } from '../services/securitySettingsService.js';
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
        '/api/health',            // browser-side probe via nginx (only /api/* is proxied)
        '/api/stream',
        '/api/viewer/heartbeat',  // Viewer heartbeat needs frequent calls (every 10s)
        // Playback session lifecycle — heartbeat fires every 5s per viewer (12/min), so
        // an open playback tab alone would eat ~12% of the shared 100/min public bucket
        // forever; during a spike the 429'd heartbeat ALSO let playback-token sessions
        // expire (dead video until reload). Same class as /api/viewer/heartbeat above.
        // /start and /stop are NOT here: they fire once per session (start = a DB insert),
        // so they stay in the shared public bucket — unlimited anonymous inserts was the
        // abuse path this closes. The /api/playback-viewer/* GET routes (active/stats/
        // history/analytics) are admin-only reads — keep them rate-limited (public
        // bucket; their auth gate is requireAdmin on the route, not this limiter).
        '/api/playback-viewer/heartbeat',
        '/api/playback-token/heartbeat',
        '/hls',                   // HLS proxy - high frequency segment requests
        '/api/internal',          // MediaMTX push hooks - bursty on restart; self-bounded (debounce + in-flight cap)
        '/api/admin/audio/node'   // Titik Speaker agents: device-token long-poll (held ~25s) — NOT an admin JWT.
                                  // Would otherwise fall under adminPrefixes (60/min per CF-IP) and 429 adzan/emergency.
    ],
    /*
     * GET/HEAD-only media prefixes. A camera grid fires dozens of thumbnail fetches per
     * page and a playback session streams a segment every few seconds — all under the
     * SAME shared 'public' bucket as JSON API calls. Measured in prod (Jul 2026): one
     * visitor on /area/kab-surabaya exhausted 100/min on thumbnails alone and every
     * subsequent /api/* call — including the playback endpoints — returned 429 until
     * the window rolled. These are cheap static/media reads with their own access
     * gates (thumbnail tenancy hook, recordings scope check); rate-limiting them buys
     * nothing and breaks real pages. JSON/control endpoints under /api/recordings
     * (start/stop/settings/segments) stay limited — only the stream/playlist paths
     * below are media.
     */
    mediaGetWhitelist: [
        '/api/thumbnails',
        // Static public image handlers behind filename allowlists — same class as
        // thumbnails: a landing load fires a burst of promo/affiliate renditions, and a
        // visitor reloading on a flapping connection must not burn the JSON bucket on them.
        '/api/promo-media',
        '/api/affiliate-media',
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
export function isWhitelisted(url, method = 'GET') {
    const path = (url || '').split('?')[0];
    if (RATE_LIMIT_CONFIG.whitelist.some(pattern =>
        path === pattern || path.startsWith(pattern + '/')
    )) {
        return true;
    }
    if (method === 'GET' || method === 'HEAD') {
        if (RATE_LIMIT_CONFIG.mediaGetWhitelist.some(pattern =>
            path === pattern || path.startsWith(pattern + '/')
        )) {
            return true;
        }
        // Recording media GETs: /api/recordings/<id>/stream/<file>,
        // /api/recordings/archive/<id>/stream, /api/recordings/<id>/playlist.m3u8
        if (path.startsWith('/api/recordings/')
            && (path.includes('/stream') || path.endsWith('/playlist.m3u8'))) {
            return true;
        }
        /*
         * Archive media GETs — the same media class as the recordings stream above:
         *  - /api/playback-archive/<id>/stream proxies Telegram-archive MP4 bytes to a
         *    public playback-token holder. A <video> element fetches it with many Range
         *    requests per segment, and local retention is only ~4h so almost every
         *    past-date replay lands here — billing them against the shared public JSON
         *    bucket (100/min) made archive playback trip 429 for the whole page.
         *    The route carries its own gates: token-cookie auth + a per-token ceiling.
         *  - /api/admin/telegram-archive/<...>/stream is the staff-side equivalent —
         *    same Range-request flood against the admin bucket (60/min).
         * Matched by `/stream` suffix (not bare prefix) so JSON routes under these
         * prefixes stay limited.
         */
        if ((path.startsWith('/api/playback-archive/') || path.startsWith('/api/admin/telegram-archive/'))
            && path.endsWith('/stream')) {
            return true;
        }
    }
    return false;
}

/**
 * Get endpoint type for rate limiting
 * @param {string} url - Request URL
 * @returns {'public' | 'auth' | 'admin' | 'whitelist'} Endpoint type
 */
export function getEndpointType(url, method = 'GET') {
    if (isWhitelisted(url, method)) {
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
 * Get rate limit configuration for endpoint type.
 * The per-type `max` is read from config (RATE_LIMIT_PUBLIC/AUTH/ADMIN env)
 * so operators can tune limits; RATE_LIMIT_CONFIG provides the fallback.
 * @param {string} endpointType - Endpoint type
 * @returns {{ max: number, window: number } | null} Rate limit config or null for whitelist
 */
export function getRateLimitForType(endpointType) {
    if (endpointType === 'whitelist') {
        return null;
    }
    const base = RATE_LIMIT_CONFIG[endpointType] || RATE_LIMIT_CONFIG.public;
    // Admin panel -> .env -> the RATE_LIMIT_CONFIG fallback above. Resolved per call, so a limit
    // changed in Settings applies to the very next request without a restart.
    const settings = getSecuritySettings();
    const configuredMax = {
        public: settings.rateLimitPublic,
        auth: settings.rateLimitAuth,
        admin: settings.rateLimitAdmin,
    }[endpointType];
    return {
        max: Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : base.max,
        window: base.window,
    };
}

/**
 * Resolve the REAL client IP for rate-limit bucketing.
 *
 * Root cause of the "everyone gets 429 on refresh" bug: behind Cloudflare →
 * cloudflared → nginx, the socket peer the backend sees is a single proxy hop
 * (e.g. 172.17.11.2), which is NOT in TRUSTED_PROXY_CIDRS, so Fastify uses it
 * verbatim as request.ip. Every public visitor then shared ONE bucket
 * (`172.17.11.2:public`) → the 100/min limit was global, not per-user.
 *
 * Cloudflare stamps the genuine visitor IP in `CF-Connecting-IP` on every
 * proxied request, so we prefer it. Fallbacks (request.ip, first XFF hop) keep
 * direct/LAN/health traffic working. A LAN client hitting the origin directly
 * could spoof the header, but that only affects rate-limit fairness (no data
 * exposure), and the origin is firewalled from the internet.
 *
 * @param {object} request - Fastify request (headers + ip)
 * @returns {string} client identifier for the rate-limit key
 */
export function resolveClientIp(request) {
    const headers = request?.headers || {};
    const cf = headers['cf-connecting-ip'];
    if (typeof cf === 'string' && cf.trim()) {
        return cf.trim();
    }
    if (request?.ip) {
        return request.ip;
    }
    const xff = headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) {
        return xff.split(',')[0].trim();
    }
    return 'unknown';
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
    
    // Get or create entry
    let entry = rateLimitStore.get(key);
    if (!entry) {
        entry = { count: 0, windowStart: now };
        rateLimitStore.set(key, entry);
    }
    
    // RAM FIX: Use fixed window counter instead of timestamp array
    // Reset window if expired
    if (now - entry.windowStart > windowMs) {
        entry.count = 0;
        entry.windowStart = now;
    }
    
    // Count requests in current window
    const requestCount = entry.count;
    const remaining = Math.max(0, limit - requestCount);
    
    // Calculate reset time
    const resetAt = entry.windowStart + windowMs;
    const retryAfter = Math.max(1, Math.ceil((resetAt - now) / 1000));
    
    // Check if limit exceeded
    if (requestCount >= limit) {
        return {
            allowed: false,
            remaining: 0,
            resetAt,
            retryAfter
        };
    }
    
    // Increment counter for current request
    entry.count++;
    
    return {
        allowed: true,
        remaining: remaining - 1,
        resetAt,
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
    
    const entry = rateLimitStore.get(key);
    if (!entry) {
        return { count: 0, remaining: limit };
    }
    
    // If window has expired, count is effectively 0
    if (now - entry.windowStart > windowMs) {
        return { count: 0, remaining: limit };
    }
    
    return {
        count: entry.count,
        remaining: Math.max(0, limit - entry.count)
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
    
    for (const [key, entry] of rateLimitStore.entries()) {
        // RAM FIX: Remove entry if window has expired
        if (now - entry.windowStart > maxWindow) {
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
 * Rate limiter middleware for Fastify.
 *
 * Implements sliding window rate limiting with different limits per endpoint type.
 * Wrapped with fastify-plugin so the onRequest hook is NOT encapsulated — without
 * fp() the hook only applies to routes inside this plugin's scope (none), which
 * silently disables rate limiting for the whole API.
 */
async function rateLimiterPlugin(fastify, options = {}) {
    // Start cleanup interval
    startCleanupInterval();
    
    // Add rate limiting hook
    fastify.addHook('onRequest', async (request, reply) => {
        // Honor the RATE_LIMIT_ENABLED kill-switch so operators can disable it
        // without a code change or redeploy.
        if (getSecuritySettings().rateLimitEnabled === false) {
            return;
        }

        const url = request.url || '';
        // Per-user key: the real visitor IP (CF-Connecting-IP), NOT the proxy hop —
        // otherwise the whole public site shares one bucket. See resolveClientIp.
        const ip = resolveClientIp(request);

        // Get endpoint type
        const endpointType = getEndpointType(url, request.method);
        
        // Skip rate limiting for whitelisted endpoints
        if (endpointType === 'whitelist') {
            return;
        }
        
        // Get rate limit config for this endpoint type.
        // NOTE: must NOT be named `config` — that would shadow the imported
        // module-level `config` for the whole hook scope (TDZ) and crash the
        // RATE_LIMIT_ENABLED check above with "Cannot access 'config'...".
        const limitConfig = getRateLimitForType(endpointType);
        if (!limitConfig) {
            return;
        }

        // Generate rate limit key
        const key = generateRateLimitKey(ip, endpointType);

        // Check rate limit
        const result = checkRateLimit(key, limitConfig.max, limitConfig.window);

        // Add rate limit headers to response
        reply.header('X-RateLimit-Limit', limitConfig.max);
        reply.header('X-RateLimit-Remaining', result.remaining);
        reply.header('X-RateLimit-Reset', Math.ceil(result.resetAt / 1000));

        // If rate limit exceeded, return 429
        if (!result.allowed) {
            // Log the violation with request object for fingerprinting
            logRateLimitViolation({
                ip,
                url,
                endpointType,
                limit: limitConfig.max,
                windowSeconds: limitConfig.window / 1000,
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

export const rateLimiterMiddleware = fp(rateLimiterPlugin, {
    name: 'rate-limiter',
    fastify: '5.x',
});

export default rateLimiterMiddleware;
