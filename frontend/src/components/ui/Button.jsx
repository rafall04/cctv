/*
 * Purpose: The single button primitive for admin surfaces — variants, sizes, loading state,
 *   focus ring, and touch-target floor in one place.
 * Caller: admin pages/components (via components/ui barrel).
 * Deps: React only.
 * MainFuncs: Button, IconButton, BUTTON_VARIANTS.
 * SideEffects: None; disables itself while `loading` so async handlers cannot double-fire.
 *
 * Why this exists: the admin surface had ~254 hand-rolled <button> elements with 18 aria-labels
 * between them, and `focus:outline-none` appeared 125 times against 25 `focus-visible` — i.e. the
 * dominant pattern removed the focus ring and replaced it with a 1px border tint. Centralising the
 * chrome means the ring, the disabled semantics and the 44px touch floor stop being per-author
 * decisions.
 */

// Shared by every variant. `focus-visible` (not `focus`) so a mouse press does not paint a ring but
// keyboard traversal always does.
//
// `outline` rather than `ring`: outline-offset leaves a transparent gap, so the indicator reads
// correctly on a sunken page, a raised card OR a filled brand button without needing a per-context
// ring-offset colour. It is also not clipped by an ancestor's overflow, which matters inside the
// scrolling table and drawer shells below.
const BASE = 'inline-flex items-center justify-center gap-2 rounded-control font-semibold ' +
    'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
    'focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-50';

export const BUTTON_VARIANTS = {
    // One primary action per view — see docs/frontend-guide.md. Flat brand fill, no gradient,
    // no coloured drop shadow: both read as marketing chrome at UI sizes. Hover shifts opacity
    // rather than a darker shade because --primary-color is set at runtime by admin branding, so
    // no darker stop is guaranteed to exist.
    primary: 'bg-primary text-white hover:opacity-90',
    secondary: 'border border-edge bg-surface text-content hover:border-edge-strong hover:bg-surface-raised',
    ghost: 'text-content-muted hover:bg-surface-raised hover:text-content',
    // Destructive stays on the fault token so "irreversible" reads the same everywhere.
    danger: 'bg-status-fault text-white hover:opacity-90',
    dangerGhost: 'text-status-fault hover:bg-status-fault/10',
};

// `sm` is 44px by default and compacts to 36px ONLY under `@media (pointer: fine)` — i.e. when a
// mouse, trackpad or stylus is doing the aiming. Dense table rows stay possible on a desktop
// without ever shipping a 36px tap target to a finger.
//
// This used to be gated on `sm:` (>=640px), which read viewport WIDTH as a proxy for pointer type.
// It is wrong at an entirely ordinary size: iPad portrait is 768px — touch, but above `sm:` — so
// every row-action button on an admin page measured 36px there, under the 44px floor, on a device
// where only a finger is available. Width never implied a mouse; the media query is the real signal.
const SIZES = {
    sm: 'min-h-11 pointer-fine:min-h-9 px-3 text-xs',
    md: 'min-h-11 px-4 text-sm',
    lg: 'min-h-12 px-5 text-sm',
};

function Spinner({ className = '' }) {
    return (
        <svg className={`h-4 w-4 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
    );
}

/**
 * @param {'primary'|'secondary'|'ghost'|'danger'|'dangerGhost'} [variant='secondary']
 * @param {'sm'|'md'|'lg'} [size='md']
 * @param {boolean} [loading] disables the button and swaps the leading icon for a spinner
 * @param {React.ReactNode} [icon] leading icon; hidden from AT (the label carries the meaning)
 * @param {boolean} [fullWidth]
 */
export function Button({
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon = null,
    iconRight = null,
    fullWidth = false,
    disabled = false,
    type = 'button',
    className = '',
    children,
    ...rest
}) {
    return (
        <button
            type={type}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={`${BASE} ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.secondary} ${SIZES[size] || SIZES.md} ${fullWidth ? 'w-full' : ''} ${className}`}
            {...rest}
        >
            {loading ? <Spinner /> : icon}
            {children != null && <span className="min-w-0 truncate">{children}</span>}
            {!loading && iconRight}
        </button>
    );
}

/**
 * Icon-only button. `label` is REQUIRED and becomes the accessible name — an icon-only control
 * without one is invisible to screen readers, which is exactly the gap the audit found.
 */
export function IconButton({
    label,
    variant = 'ghost',
    size = 'md',
    loading = false,
    disabled = false,
    type = 'button',
    className = '',
    children,
    ...rest
}) {
    // Same rule as SIZES.sm above, and for the same reason — an icon-only row action is the most
    // common `sm` control in the admin tables, so it cannot be the one left on the width proxy.
    const box = size === 'sm' ? 'h-11 w-11 pointer-fine:h-9 pointer-fine:w-9' : 'h-11 w-11';
    return (
        <button
            type={type}
            aria-label={label}
            title={label}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
            className={`${BASE} ${BUTTON_VARIANTS[variant] || BUTTON_VARIANTS.ghost} ${box} shrink-0 ${className}`}
            {...rest}
        >
            {loading ? <Spinner /> : children}
        </button>
    );
}
