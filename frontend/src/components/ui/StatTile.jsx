/*
 * Purpose: One metric tile — label, value, optional progress and footnote.
 * Caller: admin dashboards and summary rows (via components/ui barrel).
 * Deps: React, ./Card.
 * MainFuncs: StatTile, MeterBar.
 * SideEffects: None.
 *
 * Why this exists: ten admin files each defined their own stat card. Two rules are baked in here
 * because both were being got wrong:
 *  1. Values render in the mono/tabular face. The dashboard polls every 10s, and a proportional
 *     bold face re-lays-out the row every time a digit's width changes.
 *  2. A meter's colour comes from the VALUE, not from the tile. The old CPU tile was permanently
 *     amber→orange, so a box idling at 3% wore the same warning colour as one at 95%.
 */

import { Card } from './Card';

const VALUE_TONE = {
    default: 'text-content',
    live: 'text-status-live',
    warn: 'text-status-warn',
    fault: 'text-status-fault',
    data: 'text-data',
};

/** Load thresholds shared by every meter so "amber" means the same thing on CPU, memory and disk. */
export function loadTone(percent) {
    if (percent >= 90) return 'fault';
    if (percent >= 75) return 'warn';
    return 'live';
}

const BAR_TONE = {
    live: 'bg-status-live',
    warn: 'bg-status-warn',
    fault: 'bg-status-fault',
    idle: 'bg-status-idle',
    data: 'bg-data',
};

/**
 * Thin progress meter. `tone` is normally derived from the value via loadTone().
 */
export function MeterBar({ percent, tone = 'live', className = '' }) {
    const clamped = Math.min(100, Math.max(0, Number(percent) || 0));
    return (
        <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken ${className}`}>
            <div className={`h-full rounded-full transition-[width] ${BAR_TONE[tone] ?? BAR_TONE.idle}`} style={{ width: `${clamped}%` }} />
        </div>
    );
}

/**
 * Segmented meter for a breakdown that sums to a whole (online / offline / maintenance).
 * @param {Array<{key: string, percent: number, tone: string}>} segments
 */
export function SegmentedBar({ segments, className = '' }) {
    return (
        <div className={`flex h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken ${className}`}>
            {segments.filter((s) => s.percent > 0).map((segment) => (
                <div
                    key={segment.key}
                    className={`h-full ${BAR_TONE[segment.tone] ?? BAR_TONE.idle}`}
                    style={{ width: `${Math.min(100, Math.max(0, segment.percent))}%` }}
                />
            ))}
        </div>
    );
}

/**
 * @param {string} label small-caps caption
 * @param {React.ReactNode} value the headline number
 * @param {string} [unit] rendered next to the value at body size
 * @param {'default'|'live'|'warn'|'fault'|'data'} [tone='default'] colours the VALUE only
 * @param {React.ReactNode} [icon] DECORATIVE glyph — hidden from assistive tech
 * @param {React.ReactNode} [meta] meaningful header content (a trend chip); stays announced
 * @param {React.ReactNode} [footnote] one line of context under the tile
 * @param {Function} [onClick] makes the whole tile a button
 */
export function StatTile({
    label,
    value,
    unit = null,
    tone = 'default',
    icon = null,
    meta = null,
    footnote = null,
    onClick,
    className = '',
    children,
}) {
    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-content-subtle">{label}</span>
                {meta && <span className="shrink-0">{meta}</span>}
                {!meta && icon && <span className="shrink-0 text-content-subtle" aria-hidden="true">{icon}</span>}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
                <span className={`font-mono text-2xl font-bold tabular-nums leading-none ${VALUE_TONE[tone] ?? VALUE_TONE.default}`}>
                    {value}
                </span>
                {unit && <span className="text-xs text-content-muted">{unit}</span>}
            </div>
            {children && <div className="mt-3">{children}</div>}
            {footnote && <p className="mt-2 truncate text-xs text-content-muted">{footnote}</p>}
        </>
    );

    if (onClick) {
        return (
            <button
                type="button"
                onClick={onClick}
                className={`rounded-card border border-edge bg-surface p-4 text-left transition-colors hover:border-edge-strong hover:bg-surface-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${className}`}
            >
                {body}
            </button>
        );
    }

    return <Card className={className}>{body}</Card>;
}
