/*
 * Purpose: Timeline bound labels that stay honest across midnight.
 * Caller: components/playback/PlaybackTimeline.jsx.
 * Deps: Intl only. Pure.
 *
 * Time-only reads BACKWARDS for a multi-day span: "02.10 → 00.00" for 26 Agu 02:10 → 31 Agu 00:00,
 * even though start < end. With the date it reads honestly: "26 Agu 02.10 → 31 Agu 00.00". Seconds
 * are dropped (the ".01" was noise).
 *
 * Both functions take the app's CONFIGURED timezone (not the browser's) so a viewer outside WIB reads
 * the same wall-clock as the video overlay and share text. The timezone is a runtime value now, so the
 * formatters are cached per timezone instead of frozen once at module load — the hover handler calls
 * these on every mousemove.
 */

const formatterCache = new Map();
function cachedIntl(locale, options) {
    const key = `${locale}|${JSON.stringify(options)}`;
    let fmt = formatterCache.get(key);
    if (!fmt) {
        fmt = new Intl.DateTimeFormat(locale, options);
        formatterCache.set(key, fmt);
    }
    return fmt;
}

/** True when start and end fall on different calendar days in `timeZone` (the range crosses midnight). */
export function boundsSpanDays(startMs, endMs, timeZone) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    // Compare the calendar day extracted in the configured tz, not getFullYear/getMonth/getDate
    // (those read the browser's tz and would flip the answer for a non-WIB viewer).
    const dayFmt = cachedIntl('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    return dayFmt.format(new Date(startMs)) !== dayFmt.format(new Date(endMs));
}

/** A timeline bound: "02.10" within one day, "26 Agu 02.10" once the span crosses days. */
export function formatBoundLabel(ms, spansDays, timeZone) {
    if (!Number.isFinite(ms)) return '';
    const at = new Date(ms);
    // Two formatters joined by an explicit space, not one date+time formatter: id-ID glues them with a
    // comma whose exact form drifts between ICU versions ("26 Agu, 02.10"). "26 Agu" also matches the
    // coverage strip's own date style, so the two bars in the card read alike.
    const time = cachedIntl('id-ID', { hour: '2-digit', minute: '2-digit', timeZone }).format(at);
    if (!spansDays) return time;
    const date = cachedIntl('id-ID', { day: '2-digit', month: 'short', timeZone }).format(at);
    return `${date} ${time}`;
}
