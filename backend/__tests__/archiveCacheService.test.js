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
    // 0 disables the disk floor, which is what every pre-existing test wants: they are about the
    // SIZE cap, and a real temp dir on a healthy disk would otherwise always pass the floor anyway.
    process.env.TG_ARCHIVE_CACHE_MIN_FREE_BYTES = String(extra.minFree ?? 0);
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
    delete process.env.TG_ARCHIVE_CACHE_MIN_FREE_BYTES;
    vi.restoreAllMocks();
});

describe('archive cache module surface', () => {
    it('exposes every function through the DEFAULT export too', async () => {
        // server.js imports the default object. A function added only as a named export throws
        // "not a function" at boot — which is exactly how the hourly sweep shipped dead once.
        const mod = await loadCache(1000);
        for (const name of ['pin', 'release', 'isPinned', 'makeRoom', 'sweep', 'scheduleSweep', 'expire', 'stats']) {
            expect(typeof mod.default[name], `default.${name}`).toBe('function');
        }
    });
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

/*
 * The disk is a SEPARATE question from the cache.
 *
 * The size cap alone let a cache sitting far under its limit hand a download to a filesystem
 * something else had filled — on the production box that "something else" is 37 GB of docker whose
 * build cache has filled root before. What breaks then is not playback but every SQLite write on a
 * shared machine, with the archive as trigger rather than cause.
 *
 * `free` is faked rather than measured: a test cannot fill a real disk, and the whole point is the
 * case where the cache is small and the DISK is not.
 */
describe('disk floor, not just the cache cap', () => {
    const GB = 1024 * 1024 * 1024;

    /*
     * The free-space reader is INJECTED rather than mocked. Spying on the module's exported
     * freeBytes does not intercept makeRoom's own call to it — an ESM binding resolves internally,
     * not through the namespace object — so such a spy silently does nothing and the test passes
     * for the wrong reason. Passing the dependency in states it plainly instead.
     */
    const disk = (bytes) => ({ free: () => bytes });

    /** Free space that RISES as the cache shrinks, the way a real disk behaves. */
    function diskThatRecovers(base) {
        const dirBytes = () => fs.readdirSync(dir)
            .reduce((sum, name) => sum + fs.statSync(path.join(dir, name)).size, 0);
        const start = dirBytes();
        return { free: () => base + (start - dirBytes()) };
    }

    it('refuses when the disk is low even though the cache is nearly empty', async () => {
        cache = await loadCache(10 * GB, { minFree: 5 * GB });
        write('tiny.mp4', 400, 999_999);

        expect(() => cache.makeRoom(200 * 1024 * 1024, disk(300 * 1024 * 1024)))
            .toThrowError(/di bawah batas aman/i);
    });

    it('names the DISK as the reason, not the cache — they need different fixes', async () => {
        cache = await loadCache(10 * GB, { minFree: 5 * GB });

        try {
            cache.makeRoom(1000, disk(100 * 1024 * 1024));
            throw new Error('seharusnya menolak');
        } catch (err) {
            expect(err.statusCode).toBe(507);
            expect(err.message).toMatch(/BUKAN cache arsip yang penuh/i);
        }
    });

    it('evicts harder before giving up, dropping MIN_AGE but never the write grace', async () => {
        cache = await loadCache(10 * GB, { minFree: 1500, minAge: 60_000, writeGrace: 60_000 });
        const settled = write('settled.mp4', 1000, 120_000);   // past the write grace
        const arriving = write('arriving.mp4', 1000, 0);        // still being downloaded

        expect(() => cache.makeRoom(0, diskThatRecovers(1000))).not.toThrow();

        expect(fs.existsSync(settled), 'yang sudah tenang boleh digusur').toBe(false);
        expect(fs.existsSync(arriving), 'yang masih diunduh TIDAK boleh disentuh').toBe(true);
    });

    it('never evicts a pinned file to satisfy the disk floor', async () => {
        // Menghapus berkas yang sedang distream mengubah masalah disk jadi playback rusak.
        cache = await loadCache(10 * GB, { minFree: 5 * GB, writeGrace: 0, minAge: 0 });
        const watching = write('watching.mp4', 1000, 999_999);
        cache.pin(watching);

        expect(() => cache.makeRoom(1000, disk(1 * GB))).toThrow();
        expect(fs.existsSync(watching)).toBe(true);
    });

    it('skips the check entirely when free space cannot be determined', async () => {
        // statfs yang gagal harus berarti "lewati", bukan "anggap penuh" — kalau tidak, setiap
        // pemutaran jadi 507 di filesystem yang tidak biasa.
        cache = await loadCache(10 * GB, { minFree: 5 * GB });

        expect(() => cache.makeRoom(1000, disk(null))).not.toThrow();
    });

    it('freeBytes membaca disk sungguhan dan masuk akal', async () => {
        // Seam-nya boleh disuntik, tapi implementasi bawaannya harus benar-benar bekerja.
        cache = await loadCache(10 * GB);
        const free = cache.freeBytes();

        expect(typeof free === 'number' || free === null).toBe(true);
        if (typeof free === 'number') expect(free).toBeGreaterThan(0);
    });

    it('stats reports the disk beside the cap so an operator sees which limit is close', async () => {
        cache = await loadCache(10 * GB, { minFree: 5 * GB });
        const s = cache.stats();

        expect(s.minFree).toBe(5 * GB);
        expect(typeof s.free === 'number' || s.free === null).toBe(true);
    });
});
