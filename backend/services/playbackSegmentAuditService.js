/**
 * Purpose: Record WHICH clip a token holder actually watched, and what time that footage covers.
 * Caller: services/recordingPlaybackService.js (getStreamSegment).
 * Deps: services/playbackTokenService (recordAudit).
 * MainFuncs: recordSegmentWatch, resetSegmentWatchCache.
 * SideEffects: Writes one playback_token_audit_logs row per token+clip; keeps a small in-memory
 *   de-duplication map.
 *
 * WHY THIS EXISTS
 * The audit trail could say a viewer browsed a camera's recordings (`access_segments`), but nothing
 * at all about what they then played. getStreamSegment validated the request and served the file
 * without recording a thing. So the log answered "someone looked at this camera" and never "they
 * watched the 13.40–13.50 clip" — which is the question actually asked of a CCTV archive.
 *
 * WHY NOT REUSE THE EXISTING THROTTLE
 * playbackTokenService throttles `access_segments` per TOKEN for 60s. Applied here that would be
 * wrong in a specific way: watching clip A and then clip B inside a minute would record only A, and
 * the log would quietly claim the second clip was never opened. De-duplication has to be per CLIP,
 * not per token — otherwise it destroys the very fact being recorded.
 *
 * A video element issues many Range requests for one file (seek, buffer, resume), so without any
 * de-duplication a single clip would produce dozens of identical rows.
 *
 * WHY A SEPARATE FILE
 * playbackTokenService.js is frozen by the size ratchet at 1334 lines with 3 to spare; the rule is
 * to extract rather than grow.
 */

import playbackTokenService from './playbackTokenService.js';

/** One row per clip per this long. Long enough to cover watching a 10-minute clip through. */
const DEDUP_WINDOW_MS = 15 * 60 * 1000;

/** Bound on the map so a busy day cannot grow it without limit. */
const MAX_KEYS = 5000;

/** `${tokenId}:${filename}` -> epoch ms of the row we already wrote. */
const recentWatches = new Map();

function pruneCache(now) {
    for (const [key, at] of recentWatches) {
        if (now - at >= DEDUP_WINDOW_MS) recentWatches.delete(key);
    }
    // Still oversized after dropping the expired ones: evict oldest-first. Map preserves insertion
    // order, so the head is the least recently written.
    while (recentWatches.size > MAX_KEYS) {
        const oldest = recentWatches.keys().next().value;
        if (oldest === undefined) break;
        recentWatches.delete(oldest);
    }
}

/**
 * Log that a token holder played one clip.
 *
 * Only token-backed access is recorded. Anonymous public-preview views have no token to attach to,
 * and writing them would fill a token audit table with rows that identify nothing.
 *
 * @param {{tokenId: number|null, cameraId: number|string, segment: object, request: object}} params
 * @returns {boolean} true when a row was written; false when de-duplicated or not applicable
 */
export function recordSegmentWatch({ tokenId, cameraId, segment, request = {} } = {}) {
    if (!tokenId || !segment?.filename) return false;

    const key = `${tokenId}:${segment.filename}`;
    const now = Date.now();
    const lastAt = recentWatches.get(key);
    if (lastAt !== undefined && now - lastAt < DEDUP_WINDOW_MS) return false;

    recentWatches.set(key, now);
    pruneCache(now);

    try {
        playbackTokenService.recordAudit({
            tokenId,
            eventType: 'watch_segment',
            cameraId: Number(cameraId) || null,
            request,
            // start_time is the point of the whole entry: it answers "footage from when?", which is
            // a different question from created_at ("when did they click?").
            detail: {
                filename: segment.filename,
                start_time: segment.start_time || null,
                end_time: segment.end_time || null,
                duration: segment.duration || null,
            },
        });
        return true;
    } catch (error) {
        // Serving the footage matters more than logging that it was served — a failed audit write
        // must never turn a working playback into an error for the viewer.
        console.error('[PlaybackSegmentAudit] Failed to record watch:', error.message);
        return false;
    }
}

/** Test seam: the module-level cache would otherwise leak between cases. */
export function resetSegmentWatchCache() {
    recentWatches.clear();
}

export default { recordSegmentWatch, resetSegmentWatchCache };
