/**
 * API Response Cache Middleware
 * 
 * Wrapper around existing cacheService.js to provide Fastify middleware functionality.
 * Integrates with the existing cache service for consistency.
 * 
 * Features:
 * - Uses existing cacheService for storage
 * - Configurable TTL (Time To Live)
 * - Cache key based on method + URL + query params
 * - Cache hit/miss headers for debugging
 * - Manual cache invalidation support
 * 
 * Performance Impact:
 * - 95% faster response time on cache hit (100ms → 5ms)
 * - Reduced database load
 * - Better scalability for high-traffic endpoints
 */

import cache, { CacheTTL } from '../services/cacheService.js';
import { authMiddleware, requireAdmin } from './authMiddleware.js';

/**
 * Generate cache key from request
 * @param {Object} request - Fastify request object
 * @returns {string} Cache key
 */
function generateCacheKey(request) {
    const method = request.method;
    const url = request.url;
    
    // Include query params in cache key
    const queryString = request.query ? JSON.stringify(request.query) : '';
    
    return `middleware:${method}:${url}:${queryString}`;
}

/**
 * Create cache middleware
 * @param {number} ttl - Time to live in milliseconds (default: 30000 = 30s)
 * @param {Object} options - Additional options
 * @param {Function} options.keyGenerator - Custom key generator function
 * @param {Function} options.shouldCache - Function to determine if response should be cached
 * @returns {Function} Fastify preHandler middleware
 */
export function cacheMiddleware(ttl = CacheTTL.SHORT, options = {}) {
    const {
        keyGenerator = generateCacheKey,
        shouldCache = (_request, reply, _payload) => {
            // Only cache successful GET requests
            return _request.method === 'GET' && reply.statusCode === 200;
        }
    } = options;

    return async (request, reply) => {
        // Generate cache key
        const cacheKey = keyGenerator(request);
        
        // Try to get from cache
        const cached = cache.get(cacheKey);
        
        if (cached !== null) {
            // Cache hit
            reply.header('X-Cache', 'HIT');
            reply.header('X-Cache-Key', cacheKey);
            reply.type(cached.contentType || 'application/json');
            /*
             * `return reply` — NOT a bare `return`. Resolving undefined does not stop Fastify's
             * preHandler chain; it only checks `reply.sent`, and `reply.sent` is
             * `(hijacked || raw.writableEnded) === true` — i.e. it flips when the SOCKET write
             * ends, not when send() is called. This app registers two *async* onSend hooks
             * (server.js voucher cache-control, middleware/securityHeaders.js), which defer
             * writeHead/end to a later microtask, so `reply.sent` is still false when Fastify
             * decides whether to run the route handler. The handler then sent a second time:
             * ERR_HTTP_HEADERS_SENT, surfacing as an unhandledRejection thrown inside the
             * onSend hook chain — ~113/day in production, in bursts, because it only fires on a
             * cache HIT (offline cameras make clients retry inside the 30s TTL window).
             */
            reply.send(cached.payload);
            return reply;
        }
        
        // Cache miss
        reply.header('X-Cache', 'MISS');
        reply.header('X-Cache-Key', cacheKey);
        
        // Intercept reply.send to cache the response
        const originalSend = reply.send.bind(reply);
        
        reply.send = function(payload) {
            // Check if we should cache this response
            if (shouldCache(request, reply, payload)) {
                const entry = {
                    payload,
                    contentType: reply.getHeader('content-type') || 'application/json',
                };
                
                cache.set(cacheKey, entry, ttl);
            }
            
            return originalSend(payload);
        };
    };
}

/**
 * Invalidate cache entries by pattern
 * @param {string} pattern - Pattern to match cache keys
 * @returns {number} Number of entries invalidated
 */
export function invalidateCache(pattern) {
    // Use existing cache service invalidation
    const count = cache.invalidate(`middleware:GET:${pattern}`);
    console.log(`[Cache] Invalidated ${count} entries matching pattern:`, pattern);
    return count;
}

/**
 * Clear all cache entries
 */
export function clearCache() {
    const size = cache.clear();
    console.log(`[Cache] Cleared ${size} entries`);
}

/**
 * Get cache statistics
 * @returns {Object} Cache statistics
 */
export function getCacheStats() {
    return cache.stats();
}

/*
 * Cache management endpoints.
 *
 * These carried an `(admin only)` comment on every route and NOTHING enforced it. Anyone on the
 * internet could read the cache telemetry and, worse, POST a pattern to flush the server-side
 * response cache — which forces every cached public read model to be recomputed from SQLite on
 * demand, on a box that is also running the recorders. That is an availability problem written as
 * a comment.
 *
 * They were also unreachable at the documented paths. Fastify already applies the `prefix` from
 * the register() options to this encapsulated instance, and the plugin then prepended it a second
 * time — so the real paths were `/api/cache/api/cache/stats` and friends, while the
 * `/api/cache/stats` that server.js prints on boot answered 404. Nothing in the repo calls either
 * form, which is why a broken and open endpoint sat unnoticed: it was too broken to be used and
 * not broken enough to be reported.
 *
 * Paths are relative now, so the register() prefix is applied exactly once.
 *
 * @param {Object} fastify - Fastify instance
 * @param {Object} options - Plugin options (prefix comes from register(), not from here)
 */
export async function cachePlugin(fastify) {
    const adminOnly = { preHandler: [authMiddleware, requireAdmin] };

    fastify.get('/stats', adminOnly, async () => ({
        success: true,
        data: getCacheStats(),
    }));

    fastify.post('/invalidate', adminOnly, async (request, reply) => {
        const { pattern } = request.body || {};

        if (!pattern) {
            return reply.code(400).send({
                success: false,
                message: 'Pattern is required',
            });
        }

        const count = invalidateCache(pattern);

        return {
            success: true,
            message: `Invalidated ${count} cache entries`,
            count,
        };
    });

    fastify.post('/clear', adminOnly, async () => {
        clearCache();

        return {
            success: true,
            message: 'Cache cleared',
        };
    });
}

export default {
    cacheMiddleware,
    invalidateCache,
    clearCache,
    getCacheStats,
    cachePlugin,
};
