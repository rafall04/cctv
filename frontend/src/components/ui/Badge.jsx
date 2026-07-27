/*
 * Purpose: Status/label chip whose colour is a semantic token, not a decorative palette pick.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: Badge, StatusDot, TONE_CLASSES.
 * SideEffects: None.
 *
 * Why this exists: admin reached for 15 colour families (red 419x, amber 348x, emerald 306x,
 * sky 229x, purple 68x...) while the design system defines four status roles plus one data accent.
 * The collisions were not cosmetic — `maintenance` rendered red, which the token rules reserve for
 * "actually broken", so a camera held for servicing looked identical to a camera that had failed.
 */

export const TONE_CLASSES = {
    // Status roles — meaning, never decoration.
    live: 'border-status-live/30 bg-status-live/10 text-status-live',
    warn: 'border-status-warn/30 bg-status-warn/10 text-status-warn',
    fault: 'border-status-fault/30 bg-status-fault/10 text-status-fault',
    idle: 'border-status-idle/30 bg-status-idle/10 text-status-idle',
    // Data accent — counts, timings, instrument readouts. Never health.
    data: 'border-data/30 bg-data/10 text-data',
    // Structural, carries no state at all.
    neutral: 'border-edge bg-surface-raised text-content-muted',
    brand: 'border-primary-300 bg-primary-100 text-primary',
};

const DOT_CLASSES = {
    live: 'bg-status-live',
    warn: 'bg-status-warn',
    fault: 'bg-status-fault',
    idle: 'bg-status-idle',
    data: 'bg-data',
    neutral: 'bg-content-subtle',
    brand: 'bg-primary',
};

/**
 * @param {'live'|'warn'|'fault'|'idle'|'data'|'neutral'|'brand'} [tone='neutral']
 * @param {boolean} [dot] show a leading state dot
 * @param {boolean} [mono] render the label in the data/mono face (codes, counts, durations)
 */
export function Badge({ tone = 'neutral', dot = false, mono = false, className = '', children, ...rest }) {
    return (
        <span
            className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold ${
                mono ? 'font-mono tabular-nums' : ''
            } ${TONE_CLASSES[tone] ?? TONE_CLASSES.neutral} ${className}`}
            {...rest}
        >
            {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[tone] ?? DOT_CLASSES.neutral}`} aria-hidden="true" />}
            <span className="min-w-0 truncate">{children}</span>
        </span>
    );
}

/**
 * Bare state dot for dense rows. A dot must never be the sole carrier of meaning, so `label` is
 * required and ships as sr-only text next to it.
 */
export function StatusDot({ tone = 'idle', label, className = '' }) {
    return (
        <span className={`inline-flex items-center ${className}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASSES[tone] ?? DOT_CLASSES.idle}`} aria-hidden="true" />
            <span className="sr-only">{label}</span>
        </span>
    );
}
