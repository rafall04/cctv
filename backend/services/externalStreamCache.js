/*
Purpose: TTL + LRU + byte-budget cache for proxied external HLS playlists and segments.
Caller: hlsProxyRoutes.handleExternalStreamProxy and the upcoming opaque /api/stream/:id/external.* routes.
Deps: None — pure in-memory store keyed by the upstream URL.
MainFuncs: ExternalStreamCache (class), createPlaylistCache, createSegmentCache.
SideEffects: In-memory state only. No I/O. Process-local — sufficient for a single backend instance; multi-instance would need Redis.

Why we need this at all: external CCTV servers (Diskominfo / pemda) are
fragile. Every concurrent viewer used to translate into an upstream hit
because /hls/proxy is stateless. With a viewer cluster of 30 watching
the same camera, the playlist endpoint upstream was getting ~30 hits
every poll cycle (typically every 6s) just from one camera. With a 3s
playlist TTL the same scenario becomes ~10 upstream hits per minute per
camera regardless of viewer count.

Cache semantics:
  - Hard TTL — entries are unconditionally evicted after `defaultTtlMs`
    so a stale segment list never sticks.
  - LRU on entry count and total bytes — protects memory under load.
  - Only successful (200) responses get stored. Non-200 stays opt-out so
    a transient upstream blip doesn't get amplified to all viewers.
  - get() that finds an expired entry deletes it and returns null —
    callers never see stale data even if the periodic cleanup is late.
*/

const DEFAULT_PLAYLIST_TTL_MS = 3000;
const DEFAULT_SEGMENT_TTL_MS = 60000;
const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

function nowMs() {
    return Date.now();
}

/**
 * Cheap byte-size estimate. For Buffer we use .length directly; for
 * string we approximate with utf-8 byte length (worst case 4 bytes per
 * char in JS, but the realistic case for an m3u8 playlist is 1-2 bytes
 * per char). Buffer.byteLength gives the correct number.
 */
function estimateBytes(value) {
    if (Buffer.isBuffer(value)) {
        return value.length;
    }
    if (typeof value === 'string') {
        return Buffer.byteLength(value, 'utf8');
    }
    return 0;
}

export class ExternalStreamCache {
    constructor({
        defaultTtlMs = DEFAULT_PLAYLIST_TTL_MS,
        maxEntries = DEFAULT_MAX_ENTRIES,
        maxBytes = DEFAULT_MAX_BYTES,
        name = 'external-stream-cache',
    } = {}) {
        this.defaultTtlMs = defaultTtlMs;
        this.maxEntries = maxEntries;
        this.maxBytes = maxBytes;
        this.name = name;

        // Map preserves insertion order, which gives us LRU semantics for
        // free as long as we delete+set on touch.
        this.entries = new Map();
        this.totalBytes = 0;
        this.stats = { hits: 0, misses: 0, evictions: 0, writes: 0 };
    }

    /**
     * @returns {null | { statusCode, contentType, body, storedAt, expiresAt, byteSize }}
     */
    get(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            this.stats.misses += 1;
            return null;
        }

        if (entry.expiresAt <= nowMs()) {
            // Expired — drop it now so size accounting stays accurate.
            this.entries.delete(key);
            this.totalBytes -= entry.byteSize;
            this.stats.misses += 1;
            return null;
        }

        // LRU touch: re-insert at the tail of the map.
        this.entries.delete(key);
        this.entries.set(key, entry);
        this.stats.hits += 1;
        return entry;
    }

    set(key, { statusCode, contentType, body }, ttlMs = this.defaultTtlMs) {
        if (statusCode !== 200) {
            // Don't cache failures — see header comment.
            return false;
        }

        const byteSize = estimateBytes(body);
        if (byteSize === 0) {
            return false;
        }

        if (byteSize > this.maxBytes) {
            // Single entry too big to fit; refuse rather than thrash.
            return false;
        }

        // Replace existing entry if present (free its byte count first).
        const existing = this.entries.get(key);
        if (existing) {
            this.entries.delete(key);
            this.totalBytes -= existing.byteSize;
        }

        const storedAt = nowMs();
        const entry = {
            statusCode,
            contentType,
            body,
            byteSize,
            storedAt,
            expiresAt: storedAt + Math.max(1, ttlMs),
        };

        this.entries.set(key, entry);
        this.totalBytes += byteSize;
        this.stats.writes += 1;

        this.enforceLimits();
        return true;
    }

    enforceLimits() {
        // Entry-count cap.
        while (this.entries.size > this.maxEntries) {
            this.evictOldest();
        }
        // Byte cap.
        while (this.totalBytes > this.maxBytes && this.entries.size > 0) {
            this.evictOldest();
        }
    }

    evictOldest() {
        const oldestKey = this.entries.keys().next().value;
        if (oldestKey === undefined) {
            return;
        }
        const oldest = this.entries.get(oldestKey);
        this.entries.delete(oldestKey);
        if (oldest) {
            this.totalBytes -= oldest.byteSize;
        }
        this.stats.evictions += 1;
    }

    delete(key) {
        const entry = this.entries.get(key);
        if (!entry) {
            return false;
        }
        this.entries.delete(key);
        this.totalBytes -= entry.byteSize;
        return true;
    }

    clear() {
        this.entries.clear();
        this.totalBytes = 0;
    }

    /** Drop all expired entries. Optional — get() also handles expiry on read. */
    sweepExpired(now = nowMs()) {
        let dropped = 0;
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) {
                this.entries.delete(key);
                this.totalBytes -= entry.byteSize;
                dropped += 1;
            }
        }
        return dropped;
    }

    getStats() {
        return {
            name: this.name,
            entries: this.entries.size,
            totalBytes: this.totalBytes,
            maxEntries: this.maxEntries,
            maxBytes: this.maxBytes,
            ...this.stats,
        };
    }
}

export function createPlaylistCache(options = {}) {
    return new ExternalStreamCache({
        defaultTtlMs: DEFAULT_PLAYLIST_TTL_MS,
        maxEntries: 200,
        // Playlists are small (a few KB each), bound it tight.
        maxBytes: 5 * 1024 * 1024,
        name: 'external-playlist',
        ...options,
    });
}

export function createSegmentCache(options = {}) {
    return new ExternalStreamCache({
        defaultTtlMs: DEFAULT_SEGMENT_TTL_MS,
        maxEntries: DEFAULT_MAX_ENTRIES,
        maxBytes: DEFAULT_MAX_BYTES,
        name: 'external-segment',
        ...options,
    });
}

export const TTL = {
    PLAYLIST_MS: DEFAULT_PLAYLIST_TTL_MS,
    SEGMENT_MS: DEFAULT_SEGMENT_TTL_MS,
};
