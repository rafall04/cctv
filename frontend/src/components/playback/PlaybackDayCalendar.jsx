/*
 * Purpose: Pick a recording day from a month grid that SHOWS which days actually hold footage.
 * Caller: components/playback/PlaybackRangePicker.jsx.
 * Deps: React, ../ui/Modal (focus trap + Escape + scrim), ../../utils/playbackDayRange.
 * MainFuncs: PlaybackDayCalendar.
 * SideEffects: Invokes the caller's onSelect / onClose.
 *
 * WHY THIS REPLACED `<input type="date">`
 * The native picker is drawn by the OS, so nothing on the page can reach inside it to mark which
 * dates hold footage. It also only honoured `max`, leaving every day back to 1970 looking equally
 * pickable while a handful actually have recordings — choosing one answered with an empty list and
 * no explanation. Same reasoning that moved PlaybackCameraPicker off its native `<select>`.
 *
 * The dot is the whole point: green means that day has footage. Days without it are disabled rather
 * than merely undotted, because a control that accepts a choice it cannot honour is the bug we came
 * here to fix.
 */

import { memo, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { dayKeyOf } from '../../utils/playbackDayRange';

/* Minggu-first single letters, matching the Android picker these users already read. */
const WEEKDAYS = ['M', 'S', 'S', 'R', 'K', 'J', 'S'];
const MONTH_YEAR = new Intl.DateTimeFormat('id-ID', { month: 'long', year: 'numeric' });
const FULL_DAY = new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const monthOrdinal = (year, month) => year * 12 + month;

/** Leading blanks + every date in the month, so the weekday columns line up. */
function buildMonth(year, month) {
    const cells = new Array(new Date(year, month, 1).getDay()).fill(null);
    const total = new Date(year, month + 1, 0).getDate();
    for (let day = 1; day <= total; day += 1) cells.push(new Date(year, month, day));
    return cells;
}

function parseDayKey(key) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    return match ? { year: Number(match[1]), month: Number(match[2]) - 1 } : null;
}

function NavIcon({ back }) {
    return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d={back ? 'M15 19l-7-7 7-7' : 'M9 5l7 7-7 7'} />
        </svg>
    );
}

function PlaybackDayCalendar({ value, days, onSelect, onClose }) {
    const today = dayKeyOf(new Date());
    const sorted = useMemo(() => [...days].sort(), [days]);
    const hasCoverage = sorted.length > 0;

    /*
     * Open on the day already chosen; failing that on the NEWEST day that has footage, which is
     * what someone reaching for this control almost always wants. Only then on the current month.
     */
    const [cursor, setCursor] = useState(
        () => parseDayKey(value) || parseDayKey(sorted[sorted.length - 1]) || parseDayKey(today),
    );

    const cells = useMemo(() => buildMonth(cursor.year, cursor.month), [cursor]);
    const here = monthOrdinal(cursor.year, cursor.month);

    /* Never navigate past the archive in either direction — an empty month is a dead end. */
    const edge = (key, fallbackKey) => {
        const parsed = parseDayKey(key) || parseDayKey(fallbackKey);
        return monthOrdinal(parsed.year, parsed.month);
    };
    const canGoBack = !hasCoverage || here > edge(sorted[0], today);
    const canGoForward = here < (hasCoverage ? edge(sorted[sorted.length - 1], today) : edge(today, today));

    const step = (delta) => setCursor(({ year, month }) => {
        const at = new Date(year, month + delta, 1);
        return { year: at.getFullYear(), month: at.getMonth() };
    });

    return (
        <Modal title="Pilih tanggal rekaman" onClose={onClose} size="sm" placement="center">
            <div className="p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => step(-1)}
                        disabled={!canGoBack}
                        aria-label="Bulan sebelumnya"
                        className="flex h-9 w-9 items-center justify-center rounded-control border border-edge text-content-muted
                            transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <NavIcon back />
                    </button>

                    <span className="text-sm font-semibold text-content" aria-live="polite">
                        {MONTH_YEAR.format(new Date(cursor.year, cursor.month, 1))}
                    </span>

                    <button
                        type="button"
                        onClick={() => step(1)}
                        disabled={!canGoForward}
                        aria-label="Bulan berikutnya"
                        className="flex h-9 w-9 items-center justify-center rounded-control border border-edge text-content-muted
                            transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-40
                            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <NavIcon />
                    </button>
                </div>

                <div className="grid grid-cols-7 gap-0.5" role="grid">
                    {WEEKDAYS.map((label, index) => (
                        <span
                            key={`${label}-${index}`}
                            className="pb-1 text-center text-[11px] font-medium text-content-subtle"
                            aria-hidden="true"
                        >
                            {label}
                        </span>
                    ))}

                    {cells.map((date, index) => {
                        if (!date) return <span key={`blank-${index}`} aria-hidden="true" />;

                        const key = dayKeyOf(date);
                        const recorded = days.has(key);
                        // No coverage map (a scope that never received one) must not block the grid.
                        const pickable = key <= today && (!hasCoverage || recorded);
                        const selected = key === value;

                        return (
                            <button
                                key={key}
                                type="button"
                                disabled={!pickable}
                                onClick={() => onSelect(key)}
                                aria-current={selected ? 'date' : undefined}
                                aria-label={`${FULL_DAY.format(date)}${recorded ? ' — ada rekaman' : ' — tidak ada rekaman'}`}
                                className={`relative flex h-11 flex-col items-center justify-center rounded-control text-sm
                                    tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2
                                    focus-visible:ring-primary ${
                                    selected
                                        ? 'border border-primary bg-primary/10 font-semibold text-primary'
                                        : pickable
                                            ? 'text-content hover:bg-surface-raised'
                                            : 'cursor-not-allowed text-content-subtle opacity-40'
                                } ${key === today && !selected ? 'ring-1 ring-edge-strong' : ''}`}
                            >
                                <span>{date.getDate()}</span>
                                {/* Same green the coverage strip above uses for "Tersedia". */}
                                <span
                                    className={`mt-0.5 h-1.5 w-1.5 rounded-full ${recorded ? 'bg-emerald-500' : 'bg-transparent'}`}
                                    aria-hidden="true"
                                />
                            </button>
                        );
                    })}
                </div>

                {/* items-start + mt: centred, the dot floats between the two wrapped lines. */}
                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-content-muted">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden="true" />
                    Ada rekaman. Tanggal tanpa titik tidak bisa dipilih karena rekamannya sudah terhapus.
                </p>
            </div>
        </Modal>
    );
}

export default memo(PlaybackDayCalendar);
