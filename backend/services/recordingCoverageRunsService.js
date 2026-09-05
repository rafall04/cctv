/**
 * Purpose: Describe a camera's whole recorded range as a handful of contiguous runs, so the
 *          playback timeline can stay honest about the full span without shipping every segment.
 * Caller: recordingPlaybackService.getSegments.
 * Deps: connectionPool (recording_segments + telegram_archive_uploads).
 * MainFuncs: mergeIntoRuns (pure), getCoverage.
 * SideEffects: none — read-only.
 *
 * WHY THIS EXISTS
 * The timeline answers one question no other part of the page answers: "is there footage of that
 * moment, or was it never captured?" Answering it needs the SHAPE of the whole range — which is not
 * the same thing as needing every row. On production a camera holds ~1,400 segments over ten days
 * but only 14-84 contiguous runs, because ten-minute clips recorded back to back are one unbroken
 * stretch of footage. At that span a single clip is 0.63 px wide on a 900 px bar: the per-segment
 * divs were not detail, they were 1,400 invisible rectangles.
 *
 * So the list gets paginated by day and the timeline gets this — roughly 20x smaller, and it stops
 * the page having to choose between "load everything" and "hide the gaps".
 */

import { query } from '../database/connectionPool.js';

/** Below this, a seam between two clips is timer rounding, not a hole. Matches the frontend. */
export const RUN_TOLERANCE_SECONDS = 30;

function timeOf(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Collapse overlapping/adjacent intervals into runs.
 *
 * @param {Array<{from: number, to: number}>} intervals unsorted, in epoch ms
 * @returns {Array<{from: string, to: string}>} ISO bounds, oldest first
 */
export function mergeIntoRuns(intervals, { toleranceSeconds = RUN_TOLERANCE_SECONDS } = {}) {
    const usable = intervals
        .filter((interval) => Number.isFinite(interval.from) && Number.isFinite(interval.to) && interval.to >= interval.from)
        .sort((a, b) => a.from - b.from);

    const runs = [];
    const toleranceMs = toleranceSeconds * 1000;

    for (const interval of usable) {
        const last = runs[runs.length - 1];
        if (last && interval.from - last.to <= toleranceMs) {
            // Overlap is normal, not a conflict: a recent segment sits on disk AND in the archive.
            if (interval.to > last.to) last.to = interval.to;
            continue;
        }
        runs.push({ from: interval.from, to: interval.to });
    }

    return runs.map((run) => ({
        from: new Date(run.from).toISOString(),
        to: new Date(run.to).toISOString(),
    }));
}

/**
 * Both sources answer "when was there footage", in two columns each. Reading only the timestamps is
 * what keeps this cheap: no filenames, no sizes, no file_id — those belong to the row listing.
 */
const LOCAL_SQL = `
    SELECT start_time AS from_at, end_time AS to_at, duration
      FROM recording_segments
     WHERE camera_id = ?`;

const ARCHIVE_SQL = `
    SELECT recorded_at AS from_at, recorded_until AS to_at, duration_seconds AS duration
      FROM telegram_archive_uploads
     WHERE camera_id = ?
       AND status = 'ok'
       AND file_id IS NOT NULL`;

function boundsClause(range) {
    const parts = [];
    const params = [];
    if (range?.from) {
        parts.push('AND from_at >= ?');
        params.push(range.from);
    }
    if (range?.to) {
        parts.push('AND from_at <= ?');
        params.push(range.to);
    }
    return { clause: parts.join(' '), params };
}

/**
 * An end we can defend. Eight archived rows on production carry a null `recorded_until`, and reading
 * that as the epoch produced a "gap" of 1.78 billion seconds — a red band across the whole bar.
 */
function intervalOf(row) {
    const from = timeOf(row.from_at);
    if (from === null) return null;

    const to = timeOf(row.to_at);
    if (to !== null) return { from, to };

    const duration = Number(row.duration);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return { from, to: from + duration * 1000 };
}

/**
 * Clamp each interval to the entitlement bounds so the coverage bar ends EXACTLY at the token's
 * range, never a segment past it. Filtering source rows by start alone cannot do this: contiguous
 * clips merge into one run whose end is a full duration beyond its start, so a run that begins inside
 * [from, to) can still stretch past `to`. Half-open on the upper edge (drop anything that clamps to
 * zero/negative width) matches the list/stream gates, which now exclude the segment starting at `to`.
 *
 * @param {Array<{from: number, to: number}>} intervals epoch-ms intervals from intervalOf
 * @param {{from: string|null, to: string|null}|null} range entitlement bounds (ISO), or null
 */
function clampIntervalsToRange(intervals, range) {
    if (!range || (!range.from && !range.to)) return intervals;
    const loMs = range.from ? timeOf(range.from) : null;
    const hiMs = range.to ? timeOf(range.to) : null;
    const clamped = [];
    for (const interval of intervals) {
        const from = (loMs !== null && interval.from < loMs) ? loMs : interval.from;
        const to = (hiMs !== null && interval.to > hiMs) ? hiMs : interval.to;
        if (to > from) clamped.push({ from, to });
    }
    return clamped;
}

/*
 * Coverage is expensive AND hot. Computing it scans a camera's WHOLE archive history (no date cap —
 * it must describe everything reachable, not just the day on screen); on production that is ~6.5k
 * archive rows and up to 1.6 s cold. The playback page then re-asks for it every 10 s while open, and
 * because better-sqlite3 is synchronous each recompute blocks the event loop — so one operator on a
 * thick-archive camera slows every other request (live, health, billing), not just their own page.
 *
 * The answer — "which stretches of time have footage" — is quasi-static: new segments land every ten
 * minutes, archive uploads lag further. A short TTL cache turns the 6×/min recompute into ~0 ms
 * cache hits with at most a few tens of seconds of staleness, which the timeline can absolutely wear.
 * Same shape as cameraAccessService's 30 s access cache.
 */
const COVERAGE_TTL_MS = 45_000;
// A safety ceiling on distinct (camera, range) keys so a burst of token users with varied windows
// cannot grow this without bound; expired entries are pruned lazily on hit, this catches the rest.
const COVERAGE_CACHE_MAX = 500;
const coverageCache = new Map();

function cacheKeyFor(id, range) {
    return `${id}|${range?.from ?? ''}|${range?.to ?? ''}`;
}

class RecordingCoverageRunsService {
    /**
     * @param {number|string} cameraId
     * @param {{from: string|null, to: string|null}|null} [range] entitlement bounds, NOT the day the
     *   operator is looking at — coverage must describe everything they may reach, or the bar would
     *   only ever show the day already on screen.
     * @returns {{start: string|null, end: string|null, runs: Array, segments: number}}
     */
    getCoverage(cameraId, range = null) {
        const id = Number.parseInt(cameraId, 10);
        if (!Number.isInteger(id) || id <= 0) {
            return { start: null, end: null, runs: [], segments: 0 };
        }

        const now = Date.now();
        const key = cacheKeyFor(id, range);
        const hit = coverageCache.get(key);
        if (hit && hit.expires > now) return hit.value;

        const bounds = boundsClause(range);
        /*
         * Either source may be absent — a deployment without the Telegram sidecar has no archive
         * table at all. A shorter bar is a worse answer than a full one; no bar is a worse answer
         * than either, so neither read is allowed to take the listing down with it.
         */
        const read = (sql) => {
            try {
                const rows = query(`${sql} ${bounds.clause}`, [id, ...bounds.params]);
                return Array.isArray(rows) ? rows : [];
            } catch (error) {
                console.log(`[CoverageRuns] source unavailable for camera ${id}: ${error.message}`);
                return [];
            }
        };

        const rawIntervals = [...read(LOCAL_SQL), ...read(ARCHIVE_SQL)].map(intervalOf).filter(Boolean);
        // Bound the DRAWN span to the entitlement so the bar cannot overshoot the token's ceiling by a
        // segment (a merged run that spans the ceiling would otherwise be drawn to its full end).
        const intervals = clampIntervalsToRange(rawIntervals, range);
        const runs = mergeIntoRuns(intervals);

        const value = {
            start: runs.length ? runs[0].from : null,
            end: runs.length ? runs[runs.length - 1].to : null,
            runs,
            segments: intervals.length,
        };

        // Keep the map from growing unbounded: once it is full of (likely stale) keys, drop the whole
        // thing rather than tracking per-entry eviction — a cold recompute for the few still-open
        // pages is cheaper than the bookkeeping, and they refill within one poll.
        if (coverageCache.size >= COVERAGE_CACHE_MAX) coverageCache.clear();
        coverageCache.set(key, { value, expires: now + COVERAGE_TTL_MS });
        return value;
    }

    /** Test/ops seam: forget cached coverage (all cameras, or one) so the next read recomputes. */
    invalidate(cameraId = null) {
        if (cameraId === null) {
            coverageCache.clear();
            return;
        }
        const id = Number.parseInt(cameraId, 10);
        for (const key of coverageCache.keys()) {
            if (key.startsWith(`${id}|`)) coverageCache.delete(key);
        }
    }
}

export default new RecordingCoverageRunsService();
