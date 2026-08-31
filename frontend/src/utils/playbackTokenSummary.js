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

function formatRange(from, to) {
    const a = from ? formatDate(from) : null;
    const b = to ? formatDate(to) : null;
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
