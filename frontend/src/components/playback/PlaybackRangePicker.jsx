/*
 * Purpose: Choose which slice of a camera's recordings the list and the detailed timeline show.
 * Caller: components/playback/PlaybackTimeline.jsx.
 * Deps: React, ./PlaybackDayCalendar, utils/playbackDayRange.
 * MainFuncs: PlaybackRangePicker.
 * SideEffects: Invokes the caller's onRangeChange.
 *
 * The default is a ROLLING 24 hours rather than "hari ini", because "hari ini" is nearly empty at
 * 00:15 — the page would open on almost nothing every night. The named days are one tap away, and
 * the calendar reaches everything the archive holds.
 *
 * `coverage` is optional and only decides which days the calendar offers. Without it every past day
 * stays pickable, so a scope that never receives a coverage map is not locked out of its own dates.
 */

import { memo, useMemo, useState } from 'react';
import PlaybackDayCalendar from './PlaybackDayCalendar';
import {
    DEFAULT_RANGE_HOURS,
    dateInputValue,
    daysWithRecordings,
    localDayRange,
    rangeForDateInput,
    shiftDay,
} from '../../utils/playbackDayRange';

const chip = 'rounded-control border px-2.5 py-1.5 text-xs font-medium transition-colors min-h-9';
const chipOn = 'border-primary bg-primary/10 text-primary';
const chipOff = 'border-edge text-content-muted hover:bg-surface-raised';

const startOfToday = () => new Date(new Date().setHours(0, 0, 0, 0));

const PRESETS = [
    { label: `${DEFAULT_RANGE_HOURS} jam terakhir`, key: `rolling:${DEFAULT_RANGE_HOURS}`, build: () => null },
    { label: 'Hari ini', key: null, build: () => localDayRange(startOfToday()) },
    { label: 'Kemarin', key: null, build: () => localDayRange(new Date(startOfToday().getTime() - 86400000)) },
];

function ArrowButton({ label, disabled, onClick, children }) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            aria-label={label}
            title={label}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-edge
                text-content-muted transition-colors hover:bg-surface-raised disabled:cursor-not-allowed
                disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
            {children}
        </button>
    );
}

const TRIGGER_DAY = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });

function CalendarIcon() {
    return (
        <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z" />
        </svg>
    );
}

function PlaybackRangePicker({ range, onRangeChange, coverage = null }) {
    const activeDay = dateInputValue(range);
    const today = dateInputValue(localDayRange(startOfToday()));
    const [calendarOpen, setCalendarOpen] = useState(false);
    const days = useMemo(() => daysWithRecordings(coverage?.runs), [coverage]);

    return (
        <div className="mb-4 flex flex-wrap items-center gap-2">
            {PRESETS.map((preset) => {
                const built = preset.build();
                const isActive = built ? range?.key === built.key : range?.key === preset.key;
                return (
                    <button
                        key={preset.label}
                        type="button"
                        onClick={() => onRangeChange(built)}
                        className={`${chip} ${isActive ? chipOn : chipOff} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
                    >
                        {preset.label}
                    </button>
                );
            })}

            <span className="mx-1 hidden h-5 w-px bg-edge sm:block" aria-hidden="true" />

            <ArrowButton
                label="Hari sebelumnya"
                disabled={!activeDay}
                onClick={() => onRangeChange(shiftDay(range, -1))}
            >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
            </ArrowButton>

            {/*
              * A button, not `<input type="date">`. Besides being the only way to show which days
              * hold footage, it also sidesteps the iOS rule that zooms the page in on a focused
              * input under 16px — which on this page pushed the video off screen.
              */}
            <button
                type="button"
                onClick={() => setCalendarOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={calendarOpen}
                aria-label="Tanggal rekaman"
                className="flex h-9 items-center gap-1.5 rounded-control border border-edge bg-surface px-2.5 text-sm
                    tabular-nums text-content transition-colors hover:bg-surface-raised
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                <CalendarIcon />
                {activeDay
                    ? TRIGGER_DAY.format(new Date(`${activeDay}T00:00:00`))
                    : <span className="text-content-muted">Pilih tanggal</span>}
            </button>

            {calendarOpen && (
                <PlaybackDayCalendar
                    value={activeDay}
                    days={days}
                    onClose={() => setCalendarOpen(false)}
                    onSelect={(dayKey) => {
                        setCalendarOpen(false);
                        onRangeChange(rangeForDateInput(dayKey));
                    }}
                />
            )}

            <ArrowButton
                label="Hari berikutnya"
                disabled={!activeDay || activeDay >= today}
                onClick={() => onRangeChange(shiftDay(range, 1))}
            >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
            </ArrowButton>
        </div>
    );
}

export default memo(PlaybackRangePicker);
