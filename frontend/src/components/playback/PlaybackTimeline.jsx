/*
 * Purpose: Draw the whole recorded range as one bar — where footage exists, where it is missing,
 *          and where playback currently sits.
 * Caller: pages/Playback.jsx.
 * Deps: React only.
 * MainFuncs: PlaybackTimeline.
 * SideEffects: None.
 *
 * WHY THE BANDS ARE SPLIT OUT
 * `currentTime` changes on every `timeupdate` — roughly four times a second while a segment plays.
 * The bands do not depend on it, but they used to be rebuilt anyway: the sort and gap scan ran in
 * the render body, so an admin scope holding ~1,065 segments re-sorted them (≈21,000 `new Date()`
 * allocations) and reconciled 1,065 absolutely-positioned divs four times a second, forever. The
 * derived geometry is memoised on `segments`, and the bands sit behind `memo` so only the playhead
 * and the hover marker — two divs — move with the clock.
 */

import { memo, useMemo, useRef, useState } from 'react';
import PlaybackCoverageStrip from './PlaybackCoverageStrip';
import PlaybackRangePicker from './PlaybackRangePicker';
import { boundsSpanDays, formatBoundLabel } from '../../utils/playbackTimeLabel';
import { useTimezone } from '../../contexts/TimezoneContext.jsx';

/** Below this, a seam between two clips is timer rounding, not a hole worth marking. */
const GAP_THRESHOLD_SECONDS = 30;

function timeOf(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A segment's end, falling back to start + duration.
 *
 * Eight archived rows on production carry a null `end_time`, and `new Date(null)` is the epoch — it
 * produced a "gap" of 1.78 billion seconds and a red band positioned at `left:-66000%`. A missing
 * end is unknown, not 1970.
 */
function segmentEnd(segment) {
    const end = timeOf(segment.end_time);
    if (end !== null) return end;

    const start = timeOf(segment.start_time);
    const duration = Number(segment.duration);
    if (start === null || !Number.isFinite(duration) || duration <= 0) return null;
    return start + duration * 1000;
}

/**
 * Turn the segment list into ready-to-render geometry: percentage offsets for every clip and every
 * hole between them. Doing the arithmetic here means the render loop only reads numbers.
 */
export function buildTimelineGeometry(segments) {
    const placed = segments
        .map((segment) => ({ segment, from: timeOf(segment.start_time), to: segmentEnd(segment) }))
        .filter((entry) => entry.from !== null)
        .sort((a, b) => a.from - b.from);

    if (placed.length === 0) {
        return { start: null, end: null, duration: 0, bands: [], gaps: [] };
    }

    const start = placed[0].from;
    // Not `placed[last].to`: a trailing clip with an unknown end must not collapse the range.
    const end = placed.reduce((furthest, entry) => Math.max(furthest, entry.to ?? entry.from), start);
    const duration = (end - start) / 1000;
    const span = duration > 0 ? duration : 1;
    const percent = (ms) => ((ms - start) / 1000 / span) * 100;

    const bands = placed.map((entry, index) => ({
        key: entry.segment.id ?? `segment-${index}`,
        segment: entry.segment,
        left: percent(entry.from),
        width: Math.max(((entry.to ?? entry.from) - entry.from) / 1000 / span * 100, 0),
    }));

    const gaps = [];
    for (let index = 0; index < placed.length - 1; index += 1) {
        const previousEnd = placed[index].to;
        const nextStart = placed[index + 1].from;
        // An unknown end cannot prove a hole. Staying quiet is the honest answer.
        if (previousEnd === null) continue;

        const gapSeconds = (nextStart - previousEnd) / 1000;
        if (gapSeconds <= GAP_THRESHOLD_SECONDS) continue;

        gaps.push({
            key: `gap-${index}`,
            left: percent(previousEnd),
            width: (gapSeconds / span) * 100,
            minutes: Math.round(gapSeconds / 60),
        });
    }

    return { start, end, duration, bands, gaps };
}

/**
 * The bands themselves. Behind `memo` because they depend only on the footage and the selection —
 * not on the playhead, which is what actually ticks.
 */
const TimelineBands = memo(function TimelineBands({ bands, gaps, selectedSegmentId, onSegmentClick, formatTimestamp, spansDays, bandDateFmt }) {
    // On a multi-day slice a time-only tooltip is ambiguous ("02.10 - 02.20" could be any day), so
    // prepend the calendar day in the configured tz. `bandDateFmt` is stable (memoised on timezone in
    // the parent) so it doesn't defeat this memo. Single-day slices stay time-only.
    const bandTitle = (segment) => {
        const start = formatTimestamp(segment.start_time);
        const end = formatTimestamp(segment.end_time);
        if (!spansDays) return `${start} - ${end}`;
        const startDate = bandDateFmt.format(new Date(segment.start_time));
        const endDate = segment.end_time ? bandDateFmt.format(new Date(segment.end_time)) : startDate;
        return `${startDate} ${start} - ${endDate} ${end}`;
    };

    return (
        <>
            {bands.map((band) => (
                <div
                    key={band.key}
                    onClick={(e) => { e.stopPropagation(); onSegmentClick(band.segment); }}
                    className={`absolute h-full cursor-pointer transition-colors ${
                        selectedSegmentId === band.segment.id
                            ? 'bg-primary-500'
                            : 'bg-emerald-500 hover:bg-emerald-600'
                    }`}
                    style={{ left: `${band.left}%`, width: `${band.width}%` }}
                    title={bandTitle(band.segment)}
                />
            ))}

            {gaps.map((gap) => (
                <div
                    key={gap.key}
                    className="absolute h-full bg-red-500/30"
                    style={{ left: `${gap.left}%`, width: `${gap.width}%` }}
                    title={`Hilang: ${gap.minutes} menit`}
                />
            ))}
        </>
    );
});

function PlaybackTimeline({
    segments,
    selectedSegment,
    currentTime = 0,
    onSegmentClick,
    formatTimestamp,
    // { coverage, range, setRange } — present only for scopes that can reach past the current
    // slice. Absent for a public preview, which has no depth to browse.
    dayScope = null,
}) {
    const timelineRef = useRef(null);
    const [hoverPercent, setHoverPercent] = useState(null);
    const [hoverLabel, setHoverLabel] = useState('');

    // Configured (app) timezone, NOT the browser's — so a non-WIB viewer reads the same wall-clock as
    // the video overlay and share text.
    const { timezone } = useTimezone();
    // Built once per timezone and passed into the memoised bands so per-row tooltips reuse one
    // formatter instead of rebuilding it (the band list re-renders as the playhead ticks).
    const bandDateFmt = useMemo(
        () => new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short', timeZone: timezone }),
        [timezone],
    );

    const timelineData = useMemo(() => buildTimelineGeometry(segments), [segments]);

    // Live playhead: map the video's in-segment currentTime to an absolute
    // position across the whole-range timeline so the user sees where playback
    // currently is (timeline was previously blind — click-and-hope).
    let playheadOffset = null;
    if (selectedSegment && currentTime > 0 && timelineData.start !== null && timelineData.duration > 0) {
        const segStartMs = timeOf(selectedSegment.start_time);
        if (segStartMs !== null) {
            const absoluteMs = segStartMs + currentTime * 1000;
            const offset = ((absoluteMs - timelineData.start) / 1000 / timelineData.duration) * 100;
            if (offset >= 0 && offset <= 100) {
                playheadOffset = offset;
            }
        }
    }

    const handleTimelineClick = (e) => {
        if (!timelineRef.current || !timelineData.bands?.length) return;

        const rect = timelineRef.current.getBoundingClientRect();
        const clickPercent = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100));

        // Green bands stopPropagation, so this only fires for a gap / empty area. Jump to the segment
        // under the cursor, else the nearest one — measured in the SAME percent space the bands use.
        // (The old code passed whole-range seconds into a segment-relative seek, which clamped to
        //  ±180s and never navigated.) Both geometries agree, so there's no scale mismatch.
        const bands = timelineData.bands;
        let target = bands.find((b) => clickPercent >= b.left && clickPercent <= b.left + b.width);
        if (!target) {
            let best = null;
            for (const b of bands) {
                const dist = Math.abs(clickPercent - (b.left + b.width / 2));
                if (!best || dist < best.dist) best = { band: b, dist };
            }
            target = best?.band;
        }
        if (target) onSegmentClick(target.segment);
    };

    // Hover-time hint: show the timestamp under the cursor + a thin marker so
    // scrubbing isn't blind (you can see where a click will seek before clicking).
    const handleTimelineHover = (e) => {
        if (!timelineRef.current || !timelineData.duration || timelineData.start === null) return;
        const rect = timelineRef.current.getBoundingClientRect();
        const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
        const absMs = timelineData.start + pct * timelineData.duration * 1000;
        setHoverPercent(pct * 100);
        setHoverLabel(formatBoundLabel(absMs, boundsSpanDays(timelineData.start, timelineData.end, timezone), timezone));
    };

    const handleTimelineLeave = () => {
        setHoverPercent(null);
        setHoverLabel('');
    };

    const canBrowseDays = Boolean(dayScope?.coverage?.runs?.length);
    const spansDays = timelineData.start !== null && boundsSpanDays(timelineData.start, timelineData.end, timezone);
    // Nothing to place AND nothing to navigate with: the card would be an empty box.
    if (timelineData.start === null && !canBrowseDays) return null;

    return (
        <div className="bg-white dark:bg-gray-900 rounded-lg sm:rounded-xl p-3 sm:p-4 md:p-6 shadow-lg">
            {/*
              * "Cari waktu", bukan "Timeline". Kartu ini memuat DUA pekerjaan: memilih hari dan
              * rentang (CoverageStrip + RangePicker tepat di bawah judul ini) serta menggeser
              * playhead. Judul "Timeline" hanya menyebut yang kedua, jadi pengunjung yang mencari
              * "kejadian kemarin sore" tidak punya alasan membuka mata ke kartu ini sama sekali.
              * Judul menyebut PEKERJAAN pengunjung, bukan nama teknis komponennya.
              */}
            <h2 className="text-base sm:text-lg font-semibold text-content mb-3 sm:mb-4">Cari waktu</h2>

            {canBrowseDays && (
                <>
                    <PlaybackCoverageStrip
                        coverage={dayScope.coverage}
                        range={dayScope.range}
                        onRangeChange={dayScope.setRange}
                    />
                    <PlaybackRangePicker
                        range={dayScope.range}
                        onRangeChange={dayScope.setRange}
                        coverage={dayScope.coverage}
                    />
                </>
            )}

            {/*
              * A slice with no footage is a normal answer once days can be browsed — say so plainly
              * instead of leaving the controls above floating over a bar drawn from nothing.
              */}
            {timelineData.start === null ? (
                <p className="rounded-control border border-edge bg-surface-sunken px-3 py-4 text-center text-sm text-content-muted">
                    Tidak ada rekaman pada rentang ini. Pilih tanggal lain, atau klik bagian hijau pada peta di atas.
                </p>
            ) : (
            <div className="mb-4 sm:mb-6">
                <div className="flex justify-between text-xs sm:text-sm text-gray-600 dark:text-gray-400 mb-2">
                    <span>{formatBoundLabel(timelineData.start, spansDays, timezone)}</span>
                    {hoverLabel && <span className="font-semibold text-gray-900 dark:text-white">{hoverLabel}</span>}
                    <span>{formatBoundLabel(timelineData.end, spansDays, timezone)}</span>
                </div>

                <div
                    ref={timelineRef}
                    onClick={handleTimelineClick}
                    onMouseMove={handleTimelineHover}
                    onMouseLeave={handleTimelineLeave}
                    className="relative h-8 sm:h-10 md:h-12 bg-gray-200 dark:bg-gray-800 rounded-lg overflow-hidden cursor-pointer"
                >
                    <TimelineBands
                        bands={timelineData.bands}
                        gaps={timelineData.gaps}
                        selectedSegmentId={selectedSegment?.id}
                        onSegmentClick={onSegmentClick}
                        formatTimestamp={formatTimestamp}
                        spansDays={spansDays}
                        bandDateFmt={bandDateFmt}
                    />

                    {playheadOffset !== null && (
                        <div
                            className="pointer-events-none absolute top-0 bottom-0 z-10 w-0.5 bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.45)]"
                            style={{ left: `${playheadOffset}%` }}
                            aria-hidden="true"
                        />
                    )}
                    {hoverPercent !== null && (
                        <div
                            className="pointer-events-none absolute top-0 bottom-0 z-[5] w-px bg-white/60"
                            style={{ left: `${hoverPercent}%` }}
                            aria-hidden="true"
                        />
                    )}
                </div>

                {/* Wraps on purpose: three swatch+label pairs on one nowrap row measure 409px at
                  * the Android 1.5x font scale, i.e. wider than a 320px phone. */}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-content-muted">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 shrink-0 bg-emerald-500 rounded"></div>
                        <span>Tersedia</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 shrink-0 bg-primary-500 rounded"></div>
                        <span>Diputar</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 shrink-0 bg-red-500/30 rounded"></div>
                        <span>Hilang</span>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
}

export default memo(PlaybackTimeline);
