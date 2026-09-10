/*
Purpose: Tiny local wall-clock helpers for Audio Broadcast quiet-hours. Production Node runs in UTC, so
         "now" locally is Date.now() + the app UTC offset. Kept separate + pure so it's trivially testable —
         the offset is INJECTED (defaults to +7h/WIB for back-compat), never read from the DB here.
Caller: audioTargetService / audioController (quiet-hours check) — they resolve the app offset and pass it.
Deps: none.
MainFuncs: wibNowMinutes, hhmmToMinutes, isWithinWindow, isAreaQuietNow.
SideEffects: none.
*/

const WIB_OFFSET_MIN = 7 * 60; // default offset (WIB) when a caller does not inject one

/** Minutes since local midnight for "now" (0..1439). offsetMinutes defaults to WIB (+420). */
export function wibNowMinutes(now = Date.now(), offsetMinutes = WIB_OFFSET_MIN) {
    const w = new Date(now + offsetMinutes * 60000);
    return w.getUTCHours() * 60 + w.getUTCMinutes();
}

/** "HH:MM" -> minutes since midnight, or null if malformed. */
export function hhmmToMinutes(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/**
 * Is `nowMin` inside [startMin, endMin)? Handles a window that crosses midnight (start > end), the same
 * lexical-compare pattern the scheduler uses. Equal start==end means an empty window (never inside).
 */
export function isWithinWindow(nowMin, startMin, endMin) {
    if (startMin == null || endMin == null || startMin === endMin) return false;
    if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;      // same day
    return nowMin >= startMin || nowMin < endMin;                             // crosses midnight
}

/** Convenience: is an area (with quiet_start/quiet_end HH:MM) in quiet hours right now? offsetMinutes = app tz. */
export function isAreaQuietNow(area, now = Date.now(), offsetMinutes = WIB_OFFSET_MIN) {
    const start = hhmmToMinutes(area && area.quiet_start);
    const end = hhmmToMinutes(area && area.quiet_end);
    if (start == null || end == null) return false;
    return isWithinWindow(wibNowMinutes(now, offsetMinutes), start, end);
}

export default { wibNowMinutes, hhmmToMinutes, isWithinWindow, isAreaQuietNow };
