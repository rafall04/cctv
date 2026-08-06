/*
 * Purpose: Choose which slice of a camera's recordings the list and the detailed timeline show.
 * Caller: components/playback/PlaybackTimeline.jsx.
 * Deps: React, utils/playbackDayRange.
 * MainFuncs: PlaybackRangePicker.
 * SideEffects: Invokes the caller's onRangeChange.
 *
 * The default is a ROLLING 24 hours rather than "hari ini", because "hari ini" is nearly empty at
 * 00:15 — the page would open on almost nothing every night. The named days are one tap away, and
 * the date field reaches everything the archive holds.
 */

import { memo } from 'react';
import {
    DEFAULT_RANGE_HOURS,
    dateInputValue,
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

function PlaybackRangePicker({ range, onRangeChange }) {
    const activeDay = dateInputValue(range);
    const today = dateInputValue(localDayRange(startOfToday()));

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
              * text-base, not text-sm: iOS Safari zooms the whole page in when a focused input is
              * under 16px, and on this page that leaves the video off screen.
              */}
            <input
                type="date"
                value={activeDay}
                max={today}
                onChange={(event) => onRangeChange(rangeForDateInput(event.target.value))}
                aria-label="Tanggal rekaman"
                className="h-9 rounded-control border border-edge bg-surface px-2 text-base tabular-nums text-content
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-sm"
            />

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
