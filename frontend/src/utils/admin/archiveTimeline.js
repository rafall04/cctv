/*
 * Purpose: Turn a flat list of archived segments into a timeline the eye can audit — grouped by
 *          day, with GAPS between consecutive clips made explicit.
 * Caller: pages/TelegramArchiveLibrary.jsx.
 * Deps: None (pure).
 * MainFuncs: parseWhen, formatDuration, segmentWindow, buildTimeline, findSegmentAt.
 * SideEffects: None.
 *
 * The gap rule is the point of this module. A run of clips with a hole in it (camera down, upload
 * failed, disk full) currently looks EXACTLY like an unbroken run — and in a recording system that
 * silent equivalence is the most dangerous kind of lie: it lets someone conclude "there is no
 * footage of that moment" when the truth is "we never captured it and never said so".
 */

/** Tolerance before a seam counts as a gap. Segments are cut on a timer, so a few seconds of
 *  rounding between one clip's end and the next one's start is normal, not a hole. */
export const GAP_TOLERANCE_SECONDS = 90;

export function parseWhen(value) {
    if (!value) return null;
    // recording_segments stores segment times as UTC SQL ('YYYY-MM-DD HH:MM:SS'), so the 'Z' is
    // REQUIRED: verified against prod, where a clip whose own filename says 19:32:50 WIB is stored
    // as 12:32:50. Dropping it renders every label 7 hours early.
    const raw = String(value);
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = new Date(/[Z+]|-\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

const clock = (d) => d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

export function formatDuration(seconds) {
    const total = Math.round(Number(seconds) || 0);
    if (!total) return null;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h) return m ? `${h} jam ${m} mnt` : `${h} jam`;
    if (m) return s ? `${m} mnt ${s} dtk` : `${m} mnt`;
    return `${s} dtk`;
}

/** A segment is a RANGE; one start time cannot answer "which clip contains 19.36?". */
export function segmentWindow(row) {
    const start = parseWhen(row.recordedAt);
    const end = parseWhen(row.recordedUntil);
    if (!start) return { start: null, end: null, range: '—', duration: null };
    return {
        start,
        end,
        range: end ? `${clock(start)} – ${clock(end)}` : clock(start),
        duration: formatDuration(row.durationSeconds),
    };
}

function dayKey(date) {
    return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function dayLabel(date, now = new Date()) {
    const diff = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate())
        - new Date(date.getFullYear(), date.getMonth(), date.getDate())) / 86400000);
    if (diff === 0) return 'Hari ini';
    if (diff === 1) return 'Kemarin';
    return date.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Group segments by day, newest first, inserting a gap entry wherever the previous clip's end and
 * the next clip's start do not meet.
 *
 * @param {Array} rows segments as returned by the API
 * @param {boolean} detectGaps only true for a SINGLE camera — across a mixed feed a "gap" between
 *   two different cameras is meaningless, and drawing one would be a false alarm.
 */
export function buildTimeline(rows, { detectGaps = false, now = new Date() } = {}) {
    const withTime = rows
        .map((row) => ({ row, win: segmentWindow(row) }))
        .filter((entry) => entry.win.start)
        .sort((a, b) => b.win.start - a.win.start);

    const days = [];
    let current = null;

    withTime.forEach((entry, index) => {
        const key = dayKey(entry.win.start);
        if (!current || current.key !== key) {
            current = { key, label: dayLabel(entry.win.start, now), items: [] };
            days.push(current);
        }

        current.items.push({ kind: 'segment', row: entry.row, win: entry.win });

        // The list runs newest-first, so the NEXT entry is the EARLIER clip: the gap sits between
        // that one's end and this one's start.
        const next = withTime[index + 1];
        if (!detectGaps || !next || !next.win.end) return;
        const seconds = Math.round((entry.win.start - next.win.end) / 1000);
        if (seconds <= GAP_TOLERANCE_SECONDS) return;

        const sameDay = dayKey(next.win.end) === key;
        (sameDay ? current : (current = { key, label: current.label, items: current.items })).items.push({
            kind: 'gap',
            seconds,
            from: next.win.end,
            to: entry.win.start,
            label: `${clock(next.win.end)} – ${clock(entry.win.start)}`,
        });
    });

    return days;
}

/**
 * The clip covering a wall-clock time, or the nearest one before it.
 * @param {string} hhmm e.g. "19:36"
 */
export function findSegmentAt(rows, hhmm, dayHint = null) {
    const match = /^(\d{1,2})[.:](\d{2})$/.exec(String(hhmm).trim());
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours > 23 || minutes > 59) return null;

    const candidates = rows
        .map((row) => ({ row, win: segmentWindow(row) }))
        .filter((entry) => entry.win.start)
        .filter((entry) => !dayHint || dayKey(entry.win.start) === dayHint)
        .sort((a, b) => b.win.start - a.win.start);

    for (const entry of candidates) {
        const s = entry.win.start;
        const target = new Date(s.getFullYear(), s.getMonth(), s.getDate(), hours, minutes, 0);
        const end = entry.win.end || new Date(s.getTime() + (Number(entry.row.durationSeconds) || 600) * 1000);
        if (target >= s && target <= end) return entry.row;
    }
    // Nothing covers it: return the closest clip that STARTED before, so the operator lands next to
    // the moment rather than being told "not found" with no bearing.
    const before = candidates.find((entry) => {
        const s = entry.win.start;
        return new Date(s.getFullYear(), s.getMonth(), s.getDate(), hours, minutes, 0) >= s;
    });
    return before ? { ...before.row, _approximate: true } : null;
}
