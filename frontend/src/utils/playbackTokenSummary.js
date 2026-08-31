/*
Purpose: Plain-language preview of what a playback token's limits actually grant — so the operator SEES
         the effective limit while filling the form instead of decoding preset+window+expiry in their head.
Caller: PlaybackTokenForm, PlaybackTokenTable, tests.
Deps: durationUnits (pure).
MainFuncs: describeTokenLimits.
SideEffects: none.
*/

import { formatHoursHuman } from './durationUnits.js';

function formatDate(value) {
    if (!value) return '';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return String(value);
    try {
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric',
        }).format(new Date(ms));
    } catch {
        return new Date(ms).toISOString().slice(0, 10);
    }
}

// A STORED value (UTC SQL "YYYY-MM-DD HH:MM:SS", or ISO) parsed as UTC → ms. Distinct from formatDate,
// which parses a LOCAL datetime-local value from the admin form; these are for values read back from
// the server (public token panel), where a bare SQL string is UTC and must be shown in local time.
function parseStoredMs(value) {
    if (!value) return NaN;
    const s = String(value).trim();
    return Date.parse(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
}

/** UTC-stored date → local "5 Sep 2026". Empty on unparseable. */
export function formatStoredDate(value) {
    const ms = parseStoredMs(value);
    if (!Number.isFinite(ms)) return '';
    try {
        return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
    } catch {
        return new Date(ms).toISOString().slice(0, 10);
    }
}

/** UTC-stored datetime → local "5 Sep 2026, 23.05". Empty on unparseable. */
export function formatStoredDateTime(value) {
    const ms = parseStoredMs(value);
    if (!Number.isFinite(ms)) return '';
    try {
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(ms));
    } catch {
        return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    }
}

// Local datetime-local value → "26 Agu 2026, 09.10". Range endpoints show the TIME because footage
// comes in 10-minute segments, so the minute is a real boundary the customer needs to see.
function formatDateTimeLocal(value) {
    if (!value) return '';
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) return String(value);
    try {
        return new Intl.DateTimeFormat('id-ID', {
            day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
        }).format(new Date(ms));
    } catch {
        return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
    }
}

function formatRange(from, to) {
    const a = from ? formatDateTimeLocal(from) : null;
    const b = to ? formatDateTimeLocal(to) : null;
    if (a && b) return `${a} – ${b}`;
    if (a) return `sejak ${a}`;
    if (b) return `sampai ${b}`;
    return '';
}

// Build the one-line summary. All inputs optional; unknowns degrade gracefully.
export function describeTokenLimits({
    windowHours = null,
    playbackFrom = null,
    playbackTo = null,
    expiresAt = null,
    scopeType = 'all',
    cameraCount = 0,
    areaCount = 0,
} = {}) {
    let depth;
    if (playbackFrom || playbackTo) {
        depth = `rekaman ${formatRange(playbackFrom, playbackTo)}`;
    } else {
        const human = formatHoursHuman(windowHours);
        depth = human ? `rekaman ${human} terakhir` : 'semua rekaman yang tersedia';
    }

    const validity = expiresAt ? `berlaku sampai ${formatDate(expiresAt)}` : 'berlaku selamanya';

    let scope;
    if (scopeType === 'selected') {
        scope = cameraCount > 0 ? `${cameraCount} kamera terpilih` : 'kamera terpilih (belum ada)';
    } else if (scopeType === 'area') {
        scope = areaCount > 0 ? `${areaCount} area` : 'area terpilih (belum ada)';
    } else {
        scope = 'semua kamera playback';
    }

    return `Menampilkan ${depth} · ${validity} · untuk ${scope}.`;
}
