/*
 * Purpose: Bound the disk the Telegram archive cache may occupy, without ever deleting a file that
 *          is being written or read.
 * Caller: services/telegramArchiveLibraryService.js around every getFile/stream.
 * Deps: node:fs, node:path.
 * MainFuncs: pin, release, makeRoom, sweep, stats.
 * SideEffects: Deletes files under the Bot API cache directory. Nothing else.
 *
 * WHY THIS IS DELICATE
 * The local Bot API server downloads an archived segment into its own directory and never removes
 * it. Left alone that grows without limit on a box whose root has already touched 91%. But naive
 * LRU is WORSE than the disease: evicting the file a viewer is currently streaming, or one the Bot
 * API server is still writing, turns a full disk into corrupted playback.
 *
 * Four rules keep that from happening:
 *
 *  1. MAKE ROOM BEFORE FETCHING, never after. A file can therefore never trigger its own eviction,
 *     which is the classic way a "cache" deletes exactly what was just requested.
 *  2. PIN WHILE IN USE. Every stream registers its file and releases it on close/error. A pinned
 *     file is never a candidate, however old it is.
 *  3. NEVER TOUCH A FILE THAT IS STILL BEING WRITTEN. The Bot API server is a separate process, so
 *     we cannot see its handles; instead a file whose mtime is within WRITE_GRACE_MS is treated as
 *     in-flight and skipped. Its size changing between two looks proves the same thing.
 *  4. REFUSE RATHER THAN THRASH. If everything evictable is gone and there is still no room, throw
 *     a clear error instead of deleting something that is in use. A failed playback with a real
 *     message beats a broken one with none.
 *
 * A note on POSIX that makes rule 2 a belt-and-braces rather than the only guard: on Linux an
 * unlinked file stays readable through any already-open descriptor, so a stream that started before
 * an eviction finishes cleanly regardless — the space is simply reclaimed when the last handle
 * closes. That protects our own readers. It does NOT protect the Bot API server's in-progress
 * download, which is what rule 3 is for.
 */

import fs from 'fs';
import path from 'path';

const CACHE_DIR = process.env.TG_ARCHIVE_CACHE_DIR || '/var/lib/telegram-bot-api';
/*
 * 3 GB, deliberately small. This box is shared with several other projects, so the archive has no
 * business holding tens of gigabytes — and it does not need to. This directory is TRANSIT, not
 * storage: a segment lands here only long enough to reach the person who asked for it, then goes.
 * Sized to hold a handful of concurrent transfers (segments run 8-200 MB), nothing more.
 */
const MAX_BYTES = Number(process.env.TG_ARCHIVE_CACHE_MAX_BYTES || 3 * 1024 * 1024 * 1024);
/** A file touched this recently is assumed to still be downloading. */
const WRITE_GRACE_MS = Number(process.env.TG_ARCHIVE_CACHE_WRITE_GRACE_MS || 120_000);
/*
 * Short on purpose. A longer window would be right for a cache people re-seek inside, but transit
 * only has to outlive the transfer itself plus a moment for a retry. Anything kept beyond that is
 * disk taken from the other projects on this box for no one's benefit.
 */
const MIN_AGE_MS = Number(process.env.TG_ARCHIVE_CACHE_MIN_AGE_MS || 3 * 60_000);
/*
 * Hard expiry, independent of how much space is left. The size cap only fires when the directory
 * fills; without a TTL a segment fetched once could sit there for months simply because nothing
 * else came along to push it out. 24h rather than 48h on purpose: this is transit on a SHARED box,
 * so holding a file costs the other projects disk continuously, while letting it expire costs one
 * re-download to whoever comes back for it. A day already covers "I looked this morning, I want it
 * again tonight".
 *
 * A pinned file is still never touched — someone mid-download at hour 24 finishes first.
 */
const TTL_MS = Number(process.env.TG_ARCHIVE_CACHE_TTL_MS || 24 * 60 * 60_000);

/** filePath -> number of active streams. Only ever mutated through pin()/release(). */
const pinned = new Map();

export function pin(filePath) {
    if (!filePath) return;
    pinned.set(filePath, (pinned.get(filePath) || 0) + 1);
}

export function release(filePath) {
    if (!filePath) return;
    const next = (pinned.get(filePath) || 0) - 1;
    if (next > 0) {
        pinned.set(filePath, next);
        return;
    }
    pinned.delete(filePath);
    /*
     * Give the space back soon after the last reader leaves, rather than waiting for the next
     * request to notice. The delay is MIN_AGE plus a second: sweeping immediately would always be
     * a no-op, since the file it just released is still inside its own minimum age.
     */
    scheduleSweep(MIN_AGE_MS + 1000);
}

let sweepTimer = null;

/** Debounced background sweep. Never keeps the process alive on its own (unref). */
export function scheduleSweep(delayMs = 60_000) {
    if (sweepTimer) return;
    sweepTimer = setTimeout(() => {
        sweepTimer = null;
        try {
            const result = sweep();
            if (result.deleted) {
                console.log(`[archiveCache] released ${(result.freed / 1e6).toFixed(0)} MB from ${result.deleted} file(s)`);
            }
        } catch {
            // Housekeeping must never take the process with it.
        }
    }, delayMs);
    sweepTimer.unref?.();
}

export function isPinned(filePath) {
    return (pinned.get(filePath) || 0) > 0;
}

/** Every regular file under the cache dir, with the facts eviction needs. */
function listCacheFiles(dir = CACHE_DIR) {
    const out = [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return out;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...listCacheFiles(full));
            continue;
        }
        if (!entry.isFile()) continue;
        // The server's own bookkeeping must survive: deleting a binlog loses its state, not a cache
        // entry it can re-fetch.
        if (full.endsWith('.binlog')) continue;
        try {
            const stat = fs.statSync(full);
            out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs, atimeMs: stat.atimeMs });
        } catch {
            // Vanished between readdir and stat — someone else already cleaned it up.
        }
    }
    return out;
}

export function stats() {
    const files = listCacheFiles();
    const used = files.reduce((sum, f) => sum + f.size, 0);
    return { used, max: MAX_BYTES, files: files.length, pinned: pinned.size, dir: CACHE_DIR };
}

/** A file is safe to delete only if nothing holds it and nothing is still writing it. */
function evictable(file, now) {
    if (isPinned(file.path)) return false;
    if (now - file.mtimeMs < WRITE_GRACE_MS) return false; // may still be downloading
    if (now - Math.max(file.mtimeMs, file.atimeMs) < MIN_AGE_MS) return false; // recently watched
    return true;
}

/** Delete one file only after re-proving it is safe. Returns bytes freed, or 0. */
function safeUnlink(file, now) {
    if (isPinned(file.path)) return 0;
    try {
        const fresh = fs.statSync(file.path);
        // In flight: still being written, or changed since we listed it.
        if (now - fresh.mtimeMs < WRITE_GRACE_MS || fresh.size !== file.size) return 0;
        fs.unlinkSync(file.path);
        return fresh.size;
    } catch {
        return 0; // already gone, or not ours to delete
    }
}

/**
 * Drop everything past its TTL, whatever the free space. Pinned files are skipped, so a viewer who
 * is mid-transfer when the clock runs out still finishes.
 */
export function expire(now = Date.now()) {
    let freed = 0;
    let deleted = 0;
    for (const file of listCacheFiles()) {
        const lastUse = Math.max(file.mtimeMs, file.atimeMs);
        if (now - lastUse < TTL_MS) continue;
        const bytes = safeUnlink(file, now);
        if (bytes) { freed += bytes; deleted += 1; }
    }
    return { freed, deleted };
}

/**
 * Free enough space for `incomingBytes` BEFORE the download starts.
 *
 * @returns {{freed: number, deleted: number, used: number}}
 * @throws when the target cannot be reached without deleting something in use.
 */
export function makeRoom(incomingBytes = 0) {
    const now = Date.now();
    // Expired files are free wins — take them before considering anything still inside its TTL.
    const expired = expire(now);

    const files = listCacheFiles();
    let used = files.reduce((sum, f) => sum + f.size, 0);
    const budget = MAX_BYTES - Number(incomingBytes || 0);

    if (used <= budget) return { freed: expired.freed, deleted: expired.deleted, used };

    // Oldest use first — a segment nobody has touched in a week goes before today's.
    const candidates = files
        .filter((f) => evictable(f, now))
        .sort((a, b) => Math.max(a.mtimeMs, a.atimeMs) - Math.max(b.mtimeMs, b.atimeMs));

    let freed = expired.freed;
    let deleted = expired.deleted;
    for (const file of candidates) {
        if (used <= budget) break;
        // Re-checked inside safeUnlink: the file may have been pinned or re-downloaded in the time
        // this loop has been running.
        const bytes = safeUnlink(file, now);
        if (!bytes) continue;
        used -= bytes;
        freed += bytes;
        deleted += 1;
    }

    if (used > budget) {
        const err = new Error(
            'Cache arsip penuh dan tidak ada berkas yang aman dihapus '
            + `(${(used / 1e9).toFixed(1)} GB terpakai, batas ${(MAX_BYTES / 1e9).toFixed(1)} GB). `
            + 'Sisanya sedang dipakai atau baru saja diunduh — coba lagi beberapa menit.',
        );
        err.statusCode = 507; // Insufficient Storage
        throw err;
    }
    return { freed, deleted, used };
}

/** Housekeeping sweep with no incoming file — safe to call on a timer. */
export function sweep() {
    try {
        return makeRoom(0);
    } catch {
        // A full-but-all-in-use cache is not an error during idle housekeeping.
        return { freed: 0, deleted: 0, used: stats().used };
    }
}

export default { pin, release, isPinned, makeRoom, sweep, stats, CACHE_DIR, MAX_BYTES };
