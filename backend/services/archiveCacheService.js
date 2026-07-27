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
/** Default 20 GB. Comfortably under the free space measured on prod (47 GB) with room to spare. */
const MAX_BYTES = Number(process.env.TG_ARCHIVE_CACHE_MAX_BYTES || 20 * 1024 * 1024 * 1024);
/** A file touched this recently is assumed to still be downloading. */
const WRITE_GRACE_MS = Number(process.env.TG_ARCHIVE_CACHE_WRITE_GRACE_MS || 120_000);
/** Even idle, keep a file this long so a viewer who seeks back does not re-download it. */
const MIN_AGE_MS = Number(process.env.TG_ARCHIVE_CACHE_MIN_AGE_MS || 10 * 60_000);

/** filePath -> number of active streams. Only ever mutated through pin()/release(). */
const pinned = new Map();

export function pin(filePath) {
    if (!filePath) return;
    pinned.set(filePath, (pinned.get(filePath) || 0) + 1);
}

export function release(filePath) {
    if (!filePath) return;
    const next = (pinned.get(filePath) || 0) - 1;
    if (next > 0) pinned.set(filePath, next);
    else pinned.delete(filePath);
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

/**
 * Free enough space for `incomingBytes` BEFORE the download starts.
 *
 * @returns {{freed: number, deleted: number, used: number}}
 * @throws when the target cannot be reached without deleting something in use.
 */
export function makeRoom(incomingBytes = 0) {
    const now = Date.now();
    const files = listCacheFiles();
    let used = files.reduce((sum, f) => sum + f.size, 0);
    const budget = MAX_BYTES - Number(incomingBytes || 0);

    if (used <= budget) return { freed: 0, deleted: 0, used };

    // Oldest use first — a segment nobody has touched in a week goes before today's.
    const candidates = files
        .filter((f) => evictable(f, now))
        .sort((a, b) => Math.max(a.mtimeMs, a.atimeMs) - Math.max(b.mtimeMs, b.atimeMs));

    let freed = 0;
    let deleted = 0;
    for (const file of candidates) {
        if (used <= budget) break;
        // Re-check immediately before unlink: the file may have been pinned or re-downloaded in the
        // time this loop has been running.
        if (isPinned(file.path)) continue;
        try {
            const fresh = fs.statSync(file.path);
            if (now - fresh.mtimeMs < WRITE_GRACE_MS || fresh.size !== file.size) continue; // in flight
            fs.unlinkSync(file.path);
            used -= fresh.size;
            freed += fresh.size;
            deleted += 1;
        } catch {
            // Already gone, or not ours to delete — either way, move on.
        }
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
