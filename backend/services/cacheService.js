/**
 * Cache Service - In-Memory Caching dengan TTL
 * 
 * Fitur:
 * - TTL (Time To Live) per cache entry
 * - Auto cleanup expired entries
 * - Cache invalidation by key atau pattern
 * - Statistics tracking
 * - Namespace support untuk grouping
 */

// Cache storage
const cache = new Map();

// Cache statistics
const stats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    invalidations: 0
};

// Default TTL values (dalam milliseconds)
export const CacheTTL = {
    SHORT: 30 * 1000,        // 30 detik - untuk data yang sering berubah
    MEDIUM: 2 * 60 * 1000,   // 2 menit - untuk data semi-statis
    LONG: 5 * 60 * 1000,     // 5 menit - untuk data jarang berubah
    VERY_LONG: 15 * 60 * 1000, // 15 menit - untuk data statis
    HOUR: 60 * 60 * 1000     // 1 jam - untuk data sangat statis
};

// Cache namespaces untuk grouping
export const CacheNamespace = {
    CAMERAS: 'cameras',
    AREAS: 'areas',
    USERS: 'users',
    SETTINGS: 'settings',
    STREAMS: 'streams',
    STATS: 'stats',
    HEALTH: 'health'
};

/**
 * Generate cache key dengan namespace
 */
export function cacheKey(namespace, ...parts) {
    return `${namespace}:${parts.join(':')}`;
}

/**
 * Get value from cache
 * @param {string} key - Cache key
 * @returns {any|null} - Cached value atau null jika tidak ada/expired
 */
export function cacheGet(key) {
    const entry = cache.get(key);
    
    if (!entry) {
        stats.misses++;
        return null;
    }
    
    // Check if expired
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
        cache.delete(key);
        stats.misses++;
        return null;
    }
    
    stats.hits++;
    return entry.value;
}

/**
 * Set value to cache
 * @param {string} key - Cache key
 * @param {any} value - Value to cache
 * @param {number} ttl - Time to live in milliseconds (default: MEDIUM)
 */
export function cacheSet(key, value, ttl = CacheTTL.MEDIUM) {
    stats.sets++;
    cache.set(key, {
        value,
        createdAt: Date.now(),
        expiresAt: ttl > 0 ? Date.now() + ttl : null // null = never expires
    });
}

/**
 * Delete specific cache entry
 * @param {string} key - Cache key
 */
export function cacheDelete(key) {
    if (cache.has(key)) {
        cache.delete(key);
        stats.deletes++;
        return true;
    }
    return false;
}

/**
 * Invalidate cache by pattern (namespace atau prefix)
 * @param {string} pattern - Pattern to match (e.g., 'cameras:' atau 'cameras:active')
 */
export function cacheInvalidate(pattern) {
    let count = 0;
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) {
            cache.delete(key);
            count++;
        }
    }
    stats.invalidations += count;
    return count;
}

/**
 * Clear all cache
 */
export function cacheClear() {
    const size = cache.size;
    cache.clear();
    stats.invalidations += size;
    return size;
}

/**
 * Get cache statistics
 */
export function cacheStats() {
    const hitRate = stats.hits + stats.misses > 0 
        ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(2)
        : 0;
    
    return {
        ...stats,
        hitRate: `${hitRate}%`,
        size: cache.size,
        keys: Array.from(cache.keys())
    };
}

/**
 * Get or set cache (convenience method)
 * Jika cache ada, return cached value
 * Jika tidak ada, jalankan getter function dan cache hasilnya
 * 
 * @param {string} key - Cache key
 * @param {Function} getter - Async function to get value if not cached
 * @param {number} ttl - Time to live
 * @returns {Promise<any>} - Cached atau fresh value
 */
export async function cacheGetOrSet(key, getter, ttl = CacheTTL.MEDIUM) {
    const cached = cacheGet(key);
    if (cached !== null) {
        return cached;
    }
    
    const value = await getter();
    cacheSet(key, value, ttl);
    return value;
}

/**
 * Sync version of getOrSet
 */
export function cacheGetOrSetSync(key, getter, ttl = CacheTTL.MEDIUM) {
    const cached = cacheGet(key);
    if (cached !== null) {
        return cached;
    }
    
    const value = getter();
    cacheSet(key, value, ttl);
    return value;
}

// Auto cleanup expired entries setiap 60 detik
const CLEANUP_INTERVAL = 60 * 1000;
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [key, entry] of cache.entries()) {
        if (entry.expiresAt && now > entry.expiresAt) {
            cache.delete(key);
            cleaned++;
        }
    }
    
    if (cleaned > 0) {
        console.log(`[Cache] Cleaned ${cleaned} expired entries`);
    }
}, CLEANUP_INTERVAL);

export default {
    get: cacheGet,
    set: cacheSet,
    delete: cacheDelete,
    invalidate: cacheInvalidate,
    clear: cacheClear,
    stats: cacheStats,
    getOrSet: cacheGetOrSet,
    getOrSetSync: cacheGetOrSetSync,
    key: cacheKey,
    TTL: CacheTTL,
    NS: CacheNamespace
};
