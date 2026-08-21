/*
 * Purpose: One chip — the single source of truth for how every action under the public live video
 *          looks and behaves, in both of the sizes it has.
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
 * TWO SIZES, ONE ACCESSIBLE NAME — `compact`, added 2026-08-21
 * Six button-sized chips do not fit a 375px phone: last round they were put in a horizontal
 * scroller, and on the owner's real Android phone "Area" and "Lapor" were simply invisible until
 * you swiped. `compact` says "this chip is icon-only below `sm`, labelled from `sm` up", so the
 * caller declares an intent once and never branches on a breakpoint. A JS window-width state was
 * the other option and it is worse: it flickers on first paint and it makes the row's markup
 * depend on when the resize listener ran. Tailwind decides this in CSS, before React exists.
 *
 * THE HIT AREA GOES UP WHEN THE LABEL GOES AWAY
 * A labelled chip is a pill roughly 90px wide — a thumb landing anywhere along it hits. Strip the
 * word and the visible target collapses to a 16px glyph, so the *tappable* box has to grow to
 * compensate, not shrink to match the ink: `min-h-[44px] min-w-[44px]` (the platform floor on both
 * iOS and Android) against the labelled chip's 40px. Shrinking an icon-only control to its icon is
 * the mistake this file exists to prevent — see docs/frontend-guide.md, where 26–30px icon buttons
 * elsewhere in this app were measurably unreliable for a thumb. From `sm` up both shapes relax to
 * 36px, because a mouse is not a thumb.
 *
 * A HIDDEN LABEL IS STILL THE NAME
 * The moment the word disappears, `aria-label`/`title` are the ONLY thing left that says what the
 * control does — for a screen reader, and for anyone who long-presses or hovers to check before
 * committing. So the accessible name is always the FULL sentence ("Laporkan masalah pada kamera
 * ini"), never the icon's name, and it always contains the visible word so speech control still
 * works (WCAG 2.5.3). The count is appended to it here, in the primitive, so a chip whose number is
 * visually hidden below `sm` still announces it: "Kamera ini bagus, 4".
 *
 * A visible focus ring is on every chip for the same reason: a keyboard user has no hover to fall
 * back on, and an icon-only control gives them nothing else to go on.
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

const BASE = [
    'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap',
    'rounded-control border text-xs font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
].join(' ');

/*
 * Labelled: a pill. min-h-[40px] on phones, 36px from `sm` up — docs/frontend-guide.md fixes the
 * narrow-screen floor at 40px, and desktop density is unaffected. The 10px phone padding is not
 * arbitrary: it is measured (see the arithmetic in CameraDetailPanel). With five 44px squares
 * beside it, those 2px per side are a fifth of the entire slack a 360px Android phone has, and
 * they are the difference between one row and two there. Height is untouched — the padding gives
 * way, the touch target never does.
 */
const SIZE_LABELLED = 'min-h-[40px] px-2.5 sm:min-h-[36px] sm:px-3';

/*
 * Compact: a 44x44 square below `sm` (see "the hit area goes up" above), then the same pill as its
 * labelled siblings once the word comes back at `sm`. The horizontal padding is nominal — `min-w`
 * is what actually sets the width while only the icon is rendered, so the box stays square even at
 * Android's 1.3x font scaling.
 */
const SIZE_COMPACT = 'min-h-[44px] min-w-[44px] px-2 sm:min-h-[36px] sm:min-w-0 sm:px-3';

/* Below `sm` these children are not rendered at all (display:none), so they contribute no width
   AND no flex gap — which is what keeps the compact chip exactly 44px and not 44px-plus-a-gap. */
const HIDDEN_BELOW_SM = 'hidden sm:inline';

const IDLE = 'border-edge text-content-muted hover:border-edge-strong hover:bg-surface-raised';
const PRESSED = 'border-primary bg-primary-100 text-primary';

export default function ActionChip({
    icon,
    label,
    /* true = icon-only below `sm`, labelled from `sm` up. The label is still in the DOM and still
       in the accessible name; only its pixels go away. */
    compact = false,
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
     * whitespace-nowrap and shrink-0 look like they violate the "labels must be able to shrink"
     * rule, and they would in a row that could only shrink. This row WRAPS instead: truncating
     * "Bermasalah" to "Berma…" destroys the word to buy space that a second line gives away for
     * free. Refusing to shrink is what makes the wrap happen at a chip boundary rather than
     * halfway through a word.
     */
    const content = (
        <>
            {icon}
            <span className={compact ? HIDDEN_BELOW_SM : undefined}>{label}</span>
            {/*
              * Counts are omitted at zero rather than printed as "0". On a fresh install every
              * camera would show a row of zeroes, which reads as a verdict ("nobody rates anything
              * here") when the truth is only that nobody has voted yet.
              */}
            {count > 0 && (
                <span className={`tabular-nums ${compact ? HIDDEN_BELOW_SM : ''}`}>{count}</span>
            )}
        </>
    );

    /*
     * The name falls back to the visible word so a compact chip can never end up nameless, and the
     * count rides along so hiding the digits is a visual decision, not a loss of information.
     */
    const fullName = ariaLabel || label;
    const accessibleName = count > 0 ? `${fullName}, ${count}` : fullName;

    const className = `${BASE} ${compact ? SIZE_COMPACT : SIZE_LABELLED} ${pressed ? PRESSED : IDLE}`;

    if (href) {
        return (
            <a
                href={href}
                className={className}
                title={title}
                aria-label={accessibleName}
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
            aria-label={accessibleName}
            title={title}
            data-testid={testId}
            className={`${className} disabled:opacity-60`}
        >
            {content}
        </button>
    );
}
