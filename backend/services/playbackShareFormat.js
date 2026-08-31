/**
 * Purpose: Format a playback token's depth + expiry for the customer-facing share text — in the
 *          configured LOCAL timezone, with an absolute date range shown WITH its time (segments are
 *          10-minute, so the minute matters), and rolling windows in friendly units.
 * Caller: playbackTokenService.buildShareText.
 * Deps: timezoneService (configured display tz) + Intl.
 * MainFuncs: formatLocalDateTime, formatShareDepth, formatHoursHuman.
 */

import { getTimezone } from './timezoneService.js';

const UNITS = [
    { label: 'jam', hours: 1 },
    { label: 'hari', hours: 24 },
    { label: 'minggu', hours: 24 * 7 },
    { label: 'bulan', hours: 24 * 30 },
];

/** Hours → largest whole unit ("168" → "1 minggu", "720" → "1 bulan", "6" → "6 jam"). '' when empty. */
export function formatHoursHuman(hours) {
    const value = Number(hours);
    if (!Number.isFinite(value) || value <= 0) return '';
    for (let index = UNITS.length - 1; index >= 0; index -= 1) {
        if (value % UNITS[index].hours === 0) return `${value / UNITS[index].hours} ${UNITS[index].label}`;
    }
    return `${value} jam`;
}

function parseUtcMs(value) {
    if (!value) return NaN;
    const text = String(value).trim();
    return Date.parse(text.includes('T') ? text : `${text.replace(' ', 'T')}Z`);
}

/** A stored UTC SQL/ISO value → local "5 Sep 2026, 23.05". '' when unparseable. */
export function formatLocalDateTime(value) {
    const ms = parseUtcMs(value);
    if (!Number.isFinite(ms)) return '';
    try {
        return new Intl.DateTimeFormat('id-ID', {
            timeZone: getTimezone(),
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(ms));
    } catch {
        return '';
    }
}

/**
 * The playback depth line for the share text: an absolute date range (with time), a rolling window in
 * friendly units, or all recordings. `row` carries playback_from/to and playback_window_hours.
 */
export function formatShareDepth(row = {}) {
    if (row.playback_from || row.playback_to) {
        const from = row.playback_from ? formatLocalDateTime(row.playback_from) : 'awal';
        const to = row.playback_to ? formatLocalDateTime(row.playback_to) : 'sekarang';
        return `${from} – ${to}`;
    }
    if (row.playback_window_hours) {
        return `${formatHoursHuman(row.playback_window_hours)} terakhir`;
    }
    return 'Semua rekaman tersedia';
}
