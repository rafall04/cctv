/*
 * Purpose: Timeline bound labels that stay honest across midnight.
 * Caller: components/playback/PlaybackTimeline.jsx.
 * Deps: Intl only. Pure.
 *
 * Time-only reads BACKWARDS for a multi-day span: "02.10 → 00.00" for 26 Agu 02:10 → 31 Agu 00:00,
 * even though start < end. With the date it reads honestly: "26 Agu 02.10 → 31 Agu 00.00". Seconds
 * are dropped (the ".01" was noise).
 */

// Two formatters joined by an explicit space, not one date+time formatter: id-ID glues them with a
// comma whose exact form drifts between ICU versions ("26 Agu, 02.10"). "26 Agu" also matches the
// coverage strip's own date style, so the two bars in the card read alike.
const BOUND_TIME = new Intl.DateTimeFormat('id-ID', { hour: '2-digit', minute: '2-digit' });
const BOUND_DATE = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' });

/** True when start and end fall on different local calendar days (the range crosses midnight). */
export function boundsSpanDays(startMs, endMs) {
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
    const a = new Date(startMs);
    const b = new Date(endMs);
    return a.getFullYear() !== b.getFullYear()
        || a.getMonth() !== b.getMonth()
        || a.getDate() !== b.getDate();
}

/** A timeline bound: "02.10" within one day, "26 Agu 02.10" once the span crosses days. */
export function formatBoundLabel(ms, spansDays) {
    if (!Number.isFinite(ms)) return '';
    const at = new Date(ms);
    const time = BOUND_TIME.format(at);
    return spansDays ? `${BOUND_DATE.format(at)} ${time}` : time;
}
