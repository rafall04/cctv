/*
 * Purpose: Turn "which slice of the recordings am I looking at" into the ISO bounds the API takes,
 *          and back into something a date input can show.
 * Caller: hooks/playback/usePlaybackSegments.js, components/playback/PlaybackTimeline.jsx.
 * Deps: none (pure).
 * MainFuncs: rollingRange, localDayRange, dayKeyOf, dateInputValue, rangesEqual.
 * SideEffects: none.
 *
 * EVERY BOUNDARY HERE IS BUILT FROM LOCAL PARTS ON PURPOSE.
 * `toISOString()` is UTC, so for WIB (+7) any moment before 07:00 lands on the previous UTC day —
 * "hari ini" would silently mean yesterday all morning. The operator's day is the one they are
 * standing in; only the wire format is UTC.
 */

/** What the page opens on. Long enough to always hold footage, short enough to stay light. */
export const DEFAULT_RANGE_HOURS = 24;

const pad = (n) => String(n).padStart(2, '0');

/** A rolling window ending now — the default, and the only range that is never empty. */
export function rollingRange(hours = DEFAULT_RANGE_HOURS, now = Date.now()) {
    return {
        from: new Date(now - hours * 60 * 60 * 1000).toISOString(),
        to: null,
        key: `rolling:${hours}`,
    };
}

/**
 * One whole LOCAL calendar day, as UTC bounds.
 * @param {Date|number|string} within any instant inside the wanted day
 */
export function localDayRange(within) {
    const at = within instanceof Date ? within : new Date(within);
    if (Number.isNaN(at.getTime())) return rollingRange();

    const start = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 0, 0, 0, 0);
    const end = new Date(at.getFullYear(), at.getMonth(), at.getDate(), 23, 59, 59, 999);
    return {
        from: start.toISOString(),
        to: end.toISOString(),
        key: `day:${dayKeyOf(at)}`,
    };
}

/** Local YYYY-MM-DD, the format `<input type="date">` speaks. */
export function dayKeyOf(value) {
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The date a `<input type="date">` should show for this range, or '' while a rolling one is on. */
export function dateInputValue(range) {
    if (!range?.key?.startsWith('day:')) return '';
    return range.key.slice(4);
}

/** Build the range for a date input's value ('YYYY-MM-DD'). */
export function rangeForDateInput(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!match) return null;
    return localDayRange(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

/** Same slice? Compared by key so a re-created rolling window does not look like a new request. */
export function rangesEqual(a, b) {
    if (a === b) return true;
    if (!a || !b) return false;
    return a.key === b.key;
}

/** Shift a day range by whole days. Returns null when the range is not a single day. */
export function shiftDay(range, days) {
    const value = dateInputValue(range);
    if (!value) return null;
    const [year, month, day] = value.split('-').map(Number);
    return localDayRange(new Date(year, month - 1, day + days));
}
