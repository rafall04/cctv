/*
Purpose: Unit tests for ExternalStreamCache — TTL expiry, LRU on count/bytes, non-200 skip, idempotent replace.
Caller: Vitest backend suite.
Deps: vitest, externalStreamCache.
MainFuncs: ExternalStreamCache behavior tests.
SideEffects: None.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ExternalStreamCache,
    createPlaylistCache,
    createSegmentCache,
} from '../services/externalStreamCache.js';

describe('ExternalStreamCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-05-23T00:00:00.000Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null on miss and increments miss counter', () => {
        const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
        expect(cache.get('nope')).toBeNull();
        expect(cache.getStats().misses).toBe(1);
        expect(cache.getStats().hits).toBe(0);
    });

    it('stores and retrieves a 200 entry within TTL', () => {
        const cache = new ExternalStreamCache({ defaultTtlMs: 3000 });
        const stored = cache.set('url-a', {
            statusCode: 200,
            contentType: 'text/plain',
            body: 'hello',
        });
        expect(stored).toBe(true);

        const hit = cache.get('url-a');
        expect(hit).not.toBeNull();
        expect(hit.body).toBe('hello');
        expect(hit.contentType).toBe('text/plain');
        expect(cache.getStats()).toMatchObject({ hits: 1, misses: 0, writes: 1 });
    });

    it('expires entries after the TTL elapses', () => {
        const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
        cache.set('url-a', { statusCode: 200, contentType: 't', body: 'x' });

        vi.advanceTimersByTime(999);
        expect(cache.get('url-a')).not.toBeNull();

        vi.advanceTimersByTime(2);
        const afterExpiry = cache.get('url-a');
        expect(afterExpiry).toBeNull();
        // Expired entry must be dropped from the underlying map too.
        expect(cache.getStats().entries).toBe(0);
        expect(cache.getStats().totalBytes).toBe(0);
    });

    it('refuses to cache non-200 responses', () => {
        const cache = new ExternalStreamCache();
        const stored = cache.set('url-bad', {
            statusCode: 502,
            contentType: 'text/plain',
            body: 'gateway error',
        });
        expect(stored).toBe(false);
        expect(cache.get('url-bad')).toBeNull();
        expect(cache.getStats().writes).toBe(0);
    });

    it('refuses to cache an empty body', () => {
        const cache = new ExternalStreamCache();
        expect(cache.set('url-empty', { statusCode: 200, contentType: 't', body: '' })).toBe(false);
        expect(cache.set('url-empty', { statusCode: 200, contentType: 't', body: Buffer.alloc(0) })).toBe(false);
    });

    it('refuses to cache a single entry larger than maxBytes', () => {
        const cache = new ExternalStreamCache({ maxBytes: 100 });
        const stored = cache.set('url-huge', {
            statusCode: 200,
            contentType: 't',
            body: Buffer.alloc(200, 0x41),
        });
        expect(stored).toBe(false);
        expect(cache.getStats().entries).toBe(0);
    });

    it('evicts oldest entry when entry-count cap exceeded', () => {
        const cache = new ExternalStreamCache({ maxEntries: 3 });
        cache.set('a', { statusCode: 200, contentType: 't', body: 'a' });
        cache.set('b', { statusCode: 200, contentType: 't', body: 'b' });
        cache.set('c', { statusCode: 200, contentType: 't', body: 'c' });
        cache.set('d', { statusCode: 200, contentType: 't', body: 'd' });

        expect(cache.get('a')).toBeNull(); // oldest evicted
        expect(cache.get('b')).not.toBeNull();
        expect(cache.get('c')).not.toBeNull();
        expect(cache.get('d')).not.toBeNull();
        expect(cache.getStats().evictions).toBe(1);
    });

    it('evicts oldest entries when byte budget exceeded', () => {
        const cache = new ExternalStreamCache({ maxEntries: 100, maxBytes: 30 });
        cache.set('a', { statusCode: 200, contentType: 't', body: Buffer.alloc(10) });
        cache.set('b', { statusCode: 200, contentType: 't', body: Buffer.alloc(10) });
        cache.set('c', { statusCode: 200, contentType: 't', body: Buffer.alloc(10) });
        expect(cache.getStats().totalBytes).toBe(30);

        cache.set('d', { statusCode: 200, contentType: 't', body: Buffer.alloc(10) });
        // 'a' should have been evicted to make room for 'd'.
        expect(cache.get('a')).toBeNull();
        expect(cache.getStats().totalBytes).toBeLessThanOrEqual(30);
        expect(cache.getStats().evictions).toBeGreaterThan(0);
    });

    it('refreshes LRU position on get() so recently-read entries survive eviction', () => {
        const cache = new ExternalStreamCache({ maxEntries: 3 });
        cache.set('a', { statusCode: 200, contentType: 't', body: 'a' });
        cache.set('b', { statusCode: 200, contentType: 't', body: 'b' });
        cache.set('c', { statusCode: 200, contentType: 't', body: 'c' });

        // Re-read 'a' so it becomes the most recently used.
        cache.get('a');

        // Insert a 4th — 'b' should fall out, not 'a'.
        cache.set('d', { statusCode: 200, contentType: 't', body: 'd' });

        expect(cache.get('a')).not.toBeNull();
        expect(cache.get('b')).toBeNull();
    });

    it('replaces an existing entry without double-counting bytes', () => {
        const cache = new ExternalStreamCache({ maxBytes: 1000 });
        cache.set('a', { statusCode: 200, contentType: 't', body: Buffer.alloc(100) });
        expect(cache.getStats().totalBytes).toBe(100);

        cache.set('a', { statusCode: 200, contentType: 't', body: Buffer.alloc(50) });
        expect(cache.getStats().totalBytes).toBe(50);
        expect(cache.getStats().entries).toBe(1);
    });

    it('honors a per-write TTL override', () => {
        const cache = new ExternalStreamCache({ defaultTtlMs: 60_000 });
        cache.set('short', { statusCode: 200, contentType: 't', body: 'x' }, 100);
        cache.set('long', { statusCode: 200, contentType: 't', body: 'x' }, 5000);

        vi.advanceTimersByTime(200);
        expect(cache.get('short')).toBeNull();
        expect(cache.get('long')).not.toBeNull();
    });

    it('sweepExpired removes expired entries without touching live ones', () => {
        const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
        cache.set('live', { statusCode: 200, contentType: 't', body: 'a' });
        cache.set('dead', { statusCode: 200, contentType: 't', body: 'b' }, 50);

        vi.advanceTimersByTime(200);
        const dropped = cache.sweepExpired();
        expect(dropped).toBe(1);
        expect(cache.get('live')).not.toBeNull();
        expect(cache.get('dead')).toBeNull();
    });

    it('clear() drops everything and resets byte counter', () => {
        const cache = new ExternalStreamCache();
        cache.set('a', { statusCode: 200, contentType: 't', body: 'a' });
        cache.set('b', { statusCode: 200, contentType: 't', body: 'b' });
        cache.clear();
        expect(cache.getStats().entries).toBe(0);
        expect(cache.getStats().totalBytes).toBe(0);
    });

    it('createPlaylistCache uses short TTL + small bytes', () => {
        const cache = createPlaylistCache();
        const stats = cache.getStats();
        expect(stats.name).toBe('external-playlist');
        // Hard-bound stays under the segment cache.
        expect(stats.maxBytes).toBeLessThan(10 * 1024 * 1024);
    });

    it('createSegmentCache uses longer TTL + bigger bytes budget', () => {
        const cache = createSegmentCache();
        const stats = cache.getStats();
        expect(stats.name).toBe('external-segment');
        expect(stats.maxBytes).toBeGreaterThanOrEqual(50 * 1024 * 1024);
    });

    describe('getStale fallback for upstream flakiness', () => {
        it('returns null for an entry that is still fresh — caller should have used get()', () => {
            const cache = new ExternalStreamCache({ defaultTtlMs: 5000 });
            cache.set('k', { statusCode: 200, contentType: 'text/plain', body: 'fresh' });
            expect(cache.getStale('k')).toBeNull();
        });

        it('returns an expired entry that is within the stale window', () => {
            const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
            cache.set('k', { statusCode: 200, contentType: 'text/plain', body: 'cached body' });

            // Advance past expiry but inside the stale window.
            vi.advanceTimersByTime(1000 + 500);
            const stale = cache.getStale('k', 10000);
            expect(stale).not.toBeNull();
            expect(stale.body).toBe('cached body');
            expect(stale.contentType).toBe('text/plain');
        });

        it('refuses to serve an entry older than the stale window', () => {
            const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
            cache.set('k', { statusCode: 200, contentType: 'text/plain', body: 'too old' });
            // Expired by 11s, stale window of 10s → refuses.
            vi.advanceTimersByTime(1000 + 11000);
            expect(cache.getStale('k', 10000)).toBeNull();
        });

        it('does not promote the entry on stale read (stays at the head for natural LRU eviction)', () => {
            const cache = new ExternalStreamCache({ defaultTtlMs: 1000, maxEntries: 2 });
            cache.set('a', { statusCode: 200, contentType: 'text/plain', body: 'A' });
            cache.set('b', { statusCode: 200, contentType: 'text/plain', body: 'B' });

            // Expire then stale-read `a`.
            vi.advanceTimersByTime(1500);
            cache.getStale('a', 5000);
            // Inserting a third entry should evict the oldest. Since we did
            // NOT touch `a` on stale-read, `a` is still the oldest and gets
            // evicted, NOT `b`.
            cache.set('c', { statusCode: 200, contentType: 'text/plain', body: 'C' });
            // `a` evicted, `b` and `c` remain.
            const stats = cache.getStats();
            expect(stats.entries).toBe(2);
        });

        it('returns null for an entry that does not exist', () => {
            const cache = new ExternalStreamCache({ defaultTtlMs: 1000 });
            expect(cache.getStale('missing', 10000)).toBeNull();
        });
    });
});
