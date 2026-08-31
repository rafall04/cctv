/*
Purpose: Friendly duration input for playback limits — convert an hour-count to/from a {value, unit}
         pair so operators type "7 hari" instead of "168 jam". Storage stays in hours (backend unchanged).
Caller: PlaybackTokenForm, PlaybackTokenTable, playbackTokenSummary, tests.
Deps: none — pure.
MainFuncs: friendlyToHours, hoursToFriendly, formatHoursHuman.
SideEffects: none.
*/

export const DURATION_UNITS = [
    { value: 'hour', label: 'jam', hours: 1 },
    { value: 'day', label: 'hari', hours: 24 },
    { value: 'week', label: 'minggu', hours: 24 * 7 },
    { value: 'month', label: 'bulan', hours: 24 * 30 },
];

// A friendly (value, unit) pair → whole hours for storage. Invalid/empty/≤0 → null (= inherit/unlimited).
export function friendlyToHours(value, unit) {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) return null;
    const u = DURATION_UNITS.find((x) => x.value === unit) || DURATION_UNITS[0];
    return Math.round(v * u.hours);
}

// Hours → the LARGEST unit that divides evenly, so 168 → {7, week}, 720 → {1, month}, 6 → {6, hour}.
// Empty/invalid → a blank value defaulting to days (the unit most operators reach for first).
export function hoursToFriendly(hours) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return { value: '', unit: 'day' };
    for (let i = DURATION_UNITS.length - 1; i >= 0; i -= 1) {
        const u = DURATION_UNITS[i];
        if (h % u.hours === 0) return { value: h / u.hours, unit: u.value };
    }
    return { value: h, unit: 'hour' };
}

// Hours → human label, e.g. 168 → "7 minggu"... no: 168 → "1 minggu". 720 → "1 bulan". '' when empty.
export function formatHoursHuman(hours) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0) return '';
    const { value, unit } = hoursToFriendly(h);
    const found = DURATION_UNITS.find((u) => u.value === unit);
    return `${value} ${found ? found.label : 'jam'}`;
}
