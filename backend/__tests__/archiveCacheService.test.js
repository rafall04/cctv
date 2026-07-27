/*
 * Purpose: Prove the archive cache never deletes a file that is in use or still being written.
 * Caller: Backend Vitest suite.
 * Deps: services/archiveCacheService against a real temp directory.
 * MainFuncs: makeRoom / pin / release safety assertions.
 * SideEffects: Creates and removes files under a temp dir only.
 *
 * The failure this guards against is worse than the disease it cures: a cache that evicts the
 * segment a viewer is streaming, or one the Bot API server is still downloading, turns "disk full"
 * into "corrupted playback". Every test below is one of those scenarios.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let dir;
let cache;

async function loadCache(maxBytes, extra = {}) {
    vi.resetModules();
    process.env.TG_ARCHIVE_CACHE_DIR = dir;
    process.env.TG_ARCHIVE_CACHE_MAX_BYTES = String(maxBytes);
    process.env.TG_ARCHIVE_CACHE_WRITE_GRACE_MS = String(extra.writeGrace ?? 0);
    process.env.TG_ARCHIVE_CACHE_MIN_AGE_MS = String(extra.minAge ?? 0);
    process.env.TG_ARCHIVE_CACHE_TTL_MS = String(extra.ttl ?? 24 * 60 * 60_000);
    return import('../services/archiveCacheService.js');
}

function write(name, bytes, ageMs = 0) {
    const full = path.join(dir, name);
    fs.writeFileSync(full, Buffer.alloc(bytes, 1));
    if (ageMs) {
        const when = new Date(Date.now() - ageMs);
        fs.utimesSync(full, when, when);
    }
    return full;
}

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-cache-'));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.TG_ARCHIVE_CACHE_DIR;
    delete process.env.TG_ARCHIVE_CACHE_MAX_BYTES;
    delete process.env.TG_ARCHIVE_CACHE_WRITE_GRACE_MS;
    delete process.env.TG_ARCHIVE_CACHE_MIN_AGE_MS;
    delete process.env.TG_ARCHIVE_CACHE_TTL_MS;
});

describe('archive cache eviction', () => {
    it('frees the oldest files when a new segment would not fit', async () => {
        cache = await loadCache(1000);
        const old = write('old.mp4', 400, 60_000);
        const recent = write('recent.mp4', 400, 30_000);

        const result = cache.makeRoom(400);

        expect(result.deleted).toBeGreaterThan(0);
        expect(fs.existsSync(old)).toBe(false);
        // Only as much as needed — the newer file survives.
        expect(fs.existsSync(recent)).toBe(true);
    });

    it('NEVER evicts a file a viewer is streaming, however old it is', async () => {
        cache = await loadCache(1000);
        const watching = write('watching.mp4', 400, 999_999);
        const idle = write('idle.mp4', 400, 60_000);

        cache.pin(watching);
        cache.makeRoom(400);

        expect(fs.existsSync(watching)).toBe(true);
        expect(fs.existsSync(idle)).toBe(false);
    });

    it('releases a pin so the file becomes evictable again afterwards', async () => {
        cache = await loadCache(500);
        const file = write('a.mp4', 400, 999_999);

        cache.pin(file);
        expect(cache.isPinned(file)).toBe(true);
        cache.release(file);
        expect(cache.isPinned(file)).toBe(false);

        cache.makeRoom(400);
        expect(fs.existsSync(file)).toBe(false);
    });

    it('counts nested pins, so two viewers on one file both have to finish', async () => {
        cache = await loadCache(1000);
        const file = write('a.mp4', 400, 999_999);
        write('filler.mp4', 400, 999_999);

        cache.pin(file);
        cache.pin(file);
        cache.release(file);
        cache.makeRoom(400);

        // Still held by the second viewer.
        expect(fs.existsSync(file)).toBe(true);
    });

    it('never touches a file that is still being written', async () => {
        // A file whose mtime is inside the write grace is assumed to be an in-flight download.
        cache = await loadCache(500, { writeGrace: 60_000 });
        const downloading = write('downloading.mp4', 400, 0);

        expect(() => cache.makeRoom(400)).toThrow(/tidak ada berkas yang aman dihapus/);
        expect(fs.existsSync(downloading)).toBe(true);
    });

    it('refuses with 507 rather than deleting something in use', async () => {
        cache = await loadCache(500);
        const file = write('a.mp4', 400, 999_999);
        cache.pin(file);

        try {
            cache.makeRoom(400);
            throw new Error('should have refused');
        } catch (error) {
            expect(error.statusCode).toBe(507);
        }
        expect(fs.existsSync(file)).toBe(true);
    });

    it('keeps the server bookkeeping binlogs out of eviction entirely', async () => {
        cache = await loadCache(100);
        const binlog = write('tqueue.binlog', 400, 999_999);

        try { cache.makeRoom(0); } catch { /* full is fine here */ }

        expect(fs.existsSync(binlog)).toBe(true);
    });

    it('expires a file past its TTL even when there is plenty of space left', async () => {
        // The size cap only fires when the directory fills. Without a TTL a segment fetched once
        // could sit there for months simply because nothing pushed it out.
        cache = await loadCache(10_000, { ttl: 60_000 });
        const stale = write('stale.mp4', 100, 120_000);
        const fresh = write('fresh.mp4', 100, 10_000);

        const result = cache.expire();

        expect(result.deleted).toBe(1);
        expect(fs.existsSync(stale)).toBe(false);
        expect(fs.existsSync(fresh)).toBe(true);
    });

    it('will not expire a file someone is still watching, even past the TTL', async () => {
        cache = await loadCache(10_000, { ttl: 60_000 });
        const watching = write('watching.mp4', 100, 999_999);
        cache.pin(watching);

        expect(cache.expire().deleted).toBe(0);
        expect(fs.existsSync(watching)).toBe(true);
    });

    it('does nothing when the cache already fits', async () => {
        cache = await loadCache(10_000);
        write('a.mp4', 400, 999_999);
        expect(cache.makeRoom(400)).toMatchObject({ deleted: 0, freed: 0 });
    });
});
