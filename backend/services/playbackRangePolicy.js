/**
 * Purpose: Turn a caller's requested time range into bounds the segment listing can trust, and
 *          intersect it with whatever depth that caller is actually entitled to.
 * Caller: recordingPlaybackService, recordingCoverageRunsService.
 * Deps: none — pure.
 * MainFuncs: parsePlaybackRange, intersectWithAccessWindow, isWithinRange.
 * SideEffects: none.
 *
 * WHY A RANGE EXISTS AT ALL
 * An unscoped listing hands the browser every segment the caller may see. On production that was
 * ~1,065 rows / 239 KB per camera, refetched every 10 seconds by the page's background poll, and
 * rendered as ~9,000 DOM nodes. The footage is worth keeping reachable; sending all of it at once,
 * every ten seconds, is not.
 *
 * THE BOUNDS ARE ISO-8601 UTC STRINGS, AND THAT IS DELIBERATE
 * `recording_segments.start_time` and `telegram_archive_uploads.recorded_at` are both stored in one
 * fixed ISO-8601 UTC format, so a plain string comparison is chronological. The CALLER converts the
 * operator's local day into those bounds — doing it here would silently adopt the server's timezone,
 * and the server is not where the operator is standing.
 */

/** Reject anything that is not a parseable instant, so a typo narrows nothing instead of everything. */
function toIso(value) {
    if (value === undefined || value === null || value === '') return null;
    const text = String(value).trim();
    // Token bounds are stored UTC "YYYY-MM-DD HH:MM:SS" (space, NO zone). V8 reads a zoneless string as
    // the SERVER's local time, so on any non-UTC process the bound shifts by the tz offset while segment
    // timestamps (always `...Z`) do not — the 7h drift that leaked pre-window footage and hid paid
    // footage. Pin a zoneless "YYYY-MM-DD[ T]HH:MM(:SS)" to UTC; anything already carrying a zone (the
    // request's ISO-`Z` from/to) is left untouched.
    const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?$/.test(text)
        ? `${text.replace(' ', 'T')}Z`
        : text;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * @param {object} query request query string params
 * @returns {{from: string|null, to: string|null}|null} null when the caller asked for no narrowing
 */
export function parsePlaybackRange(query = {}) {
    const from = toIso(query?.from);
    const to = toIso(query?.to);
    if (!from && !to) return null;

    // A reversed pair is a mistake, not a request for an empty result: honour the wider reading
    // rather than answering "no footage" for a range that does contain some.
    if (from && to && from > to) return { from: to, to: from };
    return { from, to };
}

/** Later of two ISO instants (null = open end → the other wins). */
function laterIso(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a > b ? a : b;
}
/** Earlier of two ISO instants (null = open end → the other wins). */
function earlierIso(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    return a < b ? a : b;
}

/**
 * The absolute [fromIso, toIso] a caller is entitled to reach, as chronologically-comparable strings.
 *
 * An ABSOLUTE range (playbackFrom/playbackTo) WINS over a rolling window: a token cut to "1–5 Aug"
 * must see exactly that, never "the last N hours". A rolling window (playbackWindowHours) is a floor
 * at now−N with no ceiling. Neither set → unlimited (both null). Enforced live, so `now` matters.
 */
export function resolveAccessBounds({ playbackWindowHours = null, playbackFrom = null, playbackTo = null } = {}, now = Date.now()) {
    const fromAbs = toIso(playbackFrom);
    const toAbs = toIso(playbackTo);
    if (fromAbs || toAbs) return { fromIso: fromAbs, toIso: toAbs };
    return {
        fromIso: playbackWindowHours ? new Date(now - playbackWindowHours * 60 * 60 * 1000).toISOString() : null,
        toIso: null,
    };
}

/**
 * Narrow a requested range by the caller's entitlement.
 *
 * A token sold with 7 days of depth may ask for a day three weeks back; it must not receive it just
 * because it named the date. The entitlement is the ceiling AND the floor, the request only tightens
 * it. Accepts the access object directly (playbackWindowHours + playbackFrom/playbackTo); tests still
 * pass `{ playbackWindowHours, now }`, so `now` is read from that object when present.
 */
export function intersectWithAccessWindow(range, access = {}, now = access.now ?? Date.now()) {
    const { fromIso, toIso } = resolveAccessBounds(access, now);
    if (!fromIso && !toIso) return range || null;
    if (!range) return { from: fromIso, to: toIso };
    return {
        from: laterIso(range.from, fromIso),
        to: earlierIso(range.to, toIso),
    };
}

/** @param {{start_time: string}} segment */
export function isWithinRange(segment, range) {
    if (!range) return true;
    const at = segment?.start_time;
    if (!at) return false;
    if (range.from && at < range.from) return false;
    if (range.to && at > range.to) return false;
    return true;
}

export default { parsePlaybackRange, intersectWithAccessWindow, isWithinRange, resolveAccessBounds };
