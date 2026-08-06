/*
 * Purpose: Show the WHOLE recorded span of a camera as one thin strip — every stretch that exists,
 *          every hole between them — and let the operator jump to a day by touching it.
 * Caller: components/playback/PlaybackTimeline.jsx.
 * Deps: React, utils/playbackDayRange.
 * MainFuncs: PlaybackCoverageStrip.
 * SideEffects: Invokes the caller's onRangeChange.
 *
 * WHY IT IS SEPARATE FROM THE TIMELINE BELOW IT
 * The list and the detailed bar show ONE slice, because shipping every segment cost 239 KB per
 * camera every ten seconds. That trade is only safe if something still speaks for the days that are
 * off screen — otherwise narrowing the view would quietly hide a missing day, which is the exact
 * failure this page exists to make visible. The backend sends contiguous RUNS for this (14-84 per
 * camera against ~1,400 segments), so the honest whole-range view costs about a kilobyte.
 */

import { memo, useMemo } from 'react';
import { dayKeyOf, localDayRange } from '../../utils/playbackDayRange';

const DAY_MS = 24 * 60 * 60 * 1000;

function timeOf(value) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}

const SHORT_DAY = new Intl.DateTimeFormat('id-ID', { day: '2-digit', month: 'short' });

/**
 * Runs, the holes between them, and one tick per local midnight so the strip can be read as dates
 * rather than as an anonymous bar.
 */
function buildStrip(runs, activeRange) {
    const placed = runs
        .map((run) => ({ from: timeOf(run.from), to: timeOf(run.to) }))
        .filter((run) => run.from !== null && run.to !== null && run.to >= run.from)
        .sort((a, b) => a.from - b.from);

    if (placed.length === 0) return null;

    const start = placed[0].from;
    const end = placed[placed.length - 1].to;
    const span = Math.max(end - start, 1);
    const pct = (ms) => ((ms - start) / span) * 100;

    const bands = placed.map((run) => ({
        key: `run-${run.from}`,
        left: pct(run.from),
        width: Math.max(((run.to - run.from) / span) * 100, 0.35),
    }));

    const holes = [];
    for (let i = 0; i < placed.length - 1; i += 1) {
        holes.push({
            key: `hole-${placed[i].to}`,
            left: pct(placed[i].to),
            width: ((placed[i + 1].from - placed[i].to) / span) * 100,
            hours: Math.round(((placed[i + 1].from - placed[i].to) / 3600000) * 10) / 10,
        });
    }

    // Midnight ticks, but only while they stay legible — a 90-day archive would draw a picket fence.
    const ticks = [];
    const firstMidnight = new Date(start);
    firstMidnight.setHours(24, 0, 0, 0);
    if (span / DAY_MS <= 45) {
        for (let at = firstMidnight.getTime(); at < end; at += DAY_MS) {
            ticks.push({ key: `tick-${at}`, left: pct(at), label: SHORT_DAY.format(new Date(at)) });
        }
    }

    const activeFrom = timeOf(activeRange?.from);
    const activeTo = timeOf(activeRange?.to) ?? Date.now();
    const active = activeFrom === null ? null : {
        left: Math.max(pct(activeFrom), 0),
        width: Math.min(pct(activeTo), 100) - Math.max(pct(activeFrom), 0),
    };

    return { start, end, span, bands, holes, ticks, active: active && active.width > 0 ? active : null };
}

function PlaybackCoverageStrip({ coverage, range, onRangeChange }) {
    const strip = useMemo(
        () => buildStrip(coverage?.runs || [], range),
        [coverage, range],
    );

    if (!strip) return null;

    const jumpTo = (event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        onRangeChange(localDayRange(new Date(strip.start + ratio * strip.span)));
    };

    return (
        <div className="mb-4">
            <div className="mb-1.5 flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-content-muted">Seluruh rekaman tersimpan</span>
                <span className="font-mono text-[11px] tabular-nums text-content-subtle">
                    {dayKeyOf(strip.start)} → {dayKeyOf(strip.end)}
                </span>
            </div>

            <button
                type="button"
                onClick={jumpTo}
                aria-label="Peta seluruh rekaman — klik untuk membuka hari itu"
                className="relative block h-6 w-full overflow-hidden rounded-control border border-edge bg-surface-sunken
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
                {strip.bands.map((band) => (
                    <span
                        key={band.key}
                        className="absolute top-0 h-full bg-emerald-500/70"
                        style={{ left: `${band.left}%`, width: `${band.width}%` }}
                    />
                ))}

                {strip.holes.map((hole) => (
                    <span
                        key={hole.key}
                        className="absolute top-0 h-full bg-red-500/30"
                        style={{ left: `${hole.left}%`, width: `${hole.width}%` }}
                        title={`Tidak ada rekaman: ${hole.hours} jam`}
                    />
                ))}

                {strip.ticks.map((tick) => (
                    <span
                        key={tick.key}
                        className="absolute top-0 h-full w-px bg-edge"
                        style={{ left: `${tick.left}%` }}
                    />
                ))}

                {/* Where the list below is looking. Outlined, not filled: it must not read as footage. */}
                {strip.active && (
                    <span
                        className="pointer-events-none absolute top-0 h-full border-2 border-primary bg-primary/10"
                        style={{ left: `${strip.active.left}%`, width: `${strip.active.width}%` }}
                    />
                )}
            </button>

            <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-content-subtle">
                <span>{SHORT_DAY.format(new Date(strip.start))}</span>
                <span>{SHORT_DAY.format(new Date(strip.end))}</span>
            </div>
        </div>
    );
}

export default memo(PlaybackCoverageStrip);
