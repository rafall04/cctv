/*
 * Purpose: One chip — the single source of truth for how every action under the public live video
 *          looks and behaves.
 * Caller: MultiView/CameraDetailPanel (composes the row), MultiView/CameraReactionBar (its two
 *         vote chips).
 * Deps: none — presentation only, no data, no side effects of its own.
 * MainFuncs: ActionChip.
 * SideEffects: forwards onClick to the caller; nothing else.
 *
 * WHY A SHARED PRIMITIVE
 * The chip row replaced three button rows that had been written by three components at three
 * different times, and it showed: three padding scales, two idle border colours, and a
 * "Laporkan masalah pada kamera ini" that was not a button at all but an underlined link on its
 * own line. Stacked under the video they read as three unrelated groups of controls. One
 * component owning the appearance is the only thing that keeps six chips looking like one row six
 * months from now — a caller cannot drift the padding without editing this file, where the drift
 * is visible.
 *
 * BUTTON OR ANCHOR, DECIDED BY href
 * "Area" navigates. It has to stay a real <a href> so middle-click, long-press → "buka di tab
 * baru" and "salin alamat tautan" keep working; a <button onClick={navigate}> silently takes all
 * three away from every visitor who expected them. Pass `href` and you get an anchor; otherwise a
 * <button type="button">. Nothing else about the chip changes between the two.
 *
 * NO SECOND PRESSED LOOK
 * There is exactly one pressed appearance (primary border + tint + text) and every toggle in the
 * row uses it — vote, favourite, report. A per-chip `tone` prop is the door through which the six
 * chips walk back out to being six different buttons, so it is deliberately absent. A chip that
 * needs to say something extra says it with its ICON (the star fills), not with its own colour.
 *
 * `bg-primary-100`, NOT `bg-primary/10`
 * `--primary-color` is a bare CSS variable, not the channel triplet the semantic tokens use, so
 * Tailwind cannot compute alpha for it: `bg-primary/10` compiles to NOTHING and shipped that way
 * (verified absent from the built stylesheet). The pressed state was carrying half its signal.
 * `primary-100` is the pre-declared 10% tint in tailwind.config.js and actually renders.
 */

const BASE = 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-xs font-medium transition-colors';

/*
 * min-h-[40px] on phones, 36px from `sm` up. The row is thumb-operated on the surface it was
 * designed for, and docs/frontend-guide.md fixes the narrow-screen floor at 40px (26–30px icon
 * buttons elsewhere in this app were measurably unreliable); desktop density is unaffected.
 */
const SIZE = 'min-h-[40px] sm:min-h-[36px]';

const IDLE = 'border-edge text-content-muted hover:border-edge-strong hover:bg-surface-raised';
const PRESSED = 'border-primary bg-primary-100 text-primary';

export default function ActionChip({
    icon,
    label,
    count = 0,
    pressed,
    disabled = false,
    href,
    onClick,
    title,
    ariaLabel,
    testId,
}) {
    /*
     * whitespace-nowrap and shrink-0 look like they violate the "labels truncate" rule, and they
     * would in any row that wraps. This one scrolls instead: truncating "Bermasalah" to "Berma…"
     * destroys the word to save space the row does not need to save. The scroll container is what
     * absorbs Android's 1.3× font scaling here.
     */
    const content = (
        <>
            {icon}
            <span>{label}</span>
            {/*
              * Counts are omitted at zero rather than printed as "0". On a fresh install every
              * camera would show a row of zeroes, which reads as a verdict ("nobody rates anything
              * here") when the truth is only that nobody has voted yet.
              */}
            {count > 0 && <span className="tabular-nums">{count}</span>}
        </>
    );

    const className = `${BASE} ${SIZE} ${pressed ? PRESSED : IDLE}`;

    if (href) {
        return (
            <a
                href={href}
                className={className}
                title={title}
                aria-label={ariaLabel}
                data-testid={testId}
            >
                {content}
            </a>
        );
    }

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            /* undefined omits the attribute entirely, so a one-shot action like "Bagikan" is not
               announced as an unpressed toggle. Only real toggles pass a boolean. */
            aria-pressed={pressed}
            aria-label={ariaLabel}
            title={title}
            data-testid={testId}
            className={`${className} disabled:opacity-60`}
        >
            {content}
        </button>
    );
}
