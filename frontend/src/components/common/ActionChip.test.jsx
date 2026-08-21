// @vitest-environment jsdom

/*
 * Purpose: Pin the ONE appearance and the ONE set of behaviours every action under the public live
 *          video now shares, so the six chips cannot drift back into six different buttons.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, ActionChip.
 * SideEffects: jsdom render only.
 *
 * WHY THIS FILE EXISTS AT ALL
 * The chip row replaced three separately-written button rows, and the drift between those rows —
 * three padding scales, two idle borders, one control that was not a button at all — is exactly
 * what a shared primitive is supposed to make impossible. That guarantee is only real if something
 * asserts it, so the class contract is tested here rather than six times over in the panel.
 *
 * AND WHY `compact` IS TESTED HARDEST — 2026-08-21
 * Six button-sized chips do not fit a 375px phone. The first attempt put them in a horizontal
 * scroller and, on the owner's real Android phone, "Area" and "Lapor" were simply INVISIBLE until
 * you swiped. The fix is `compact`: icon-only below `sm`, labelled from `sm` up. That trade is only
 * safe while two things hold, so both are asserted below and neither may be relaxed:
 *   · the accessible name survives the label going away (it is the ONLY thing left that says what
 *     the control does — for a screen reader, and for a long-press tooltip), and
 *   · the TOUCH TARGET GROWS rather than shrinks: 44x44, because a 16px glyph is a smaller visual
 *     target than a 90px pill and the thumb has to be given back what the eye lost.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ActionChip from './ActionChip';

const classesOf = (el) => (el.getAttribute('class') || '').split(/\s+/).filter(Boolean);

describe('ActionChip', () => {
    it('acts as a <button type="button"> and reports the tap', () => {
        const onClick = vi.fn();
        render(<ActionChip label="Bagikan" onClick={onClick} ariaLabel="Bagikan kamera ini" />);

        const chip = screen.getByRole('button', { name: 'Bagikan kamera ini' });
        expect(chip.tagName).toBe('BUTTON');
        // Without type="button" a chip inside the report form's <form> would submit it.
        expect(chip.getAttribute('type')).toBe('button');

        fireEvent.click(chip);
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    /*
     * "Area" navigates. A <button onClick={navigate}> silently removes middle-click, long-press →
     * "buka di tab baru" and "salin alamat tautan" from every visitor who expected them.
     */
    it('is a real anchor with a real href when it navigates, never a button', () => {
        render(<ActionChip label="Area" href="/area/ds-dander" ariaLabel="Buka area" />);

        const chip = screen.getByRole('link', { name: 'Buka area' });
        expect(chip.tagName).toBe('A');
        expect(chip.getAttribute('href')).toBe('/area/ds-dander');
        expect(screen.queryByRole('button')).toBeNull();
    });

    /* On a fresh install a row of zeroes reads as a verdict ("nobody rates anything here") when
       the truth is only that nobody has voted yet. */
    it('omits the count at zero rather than printing "0"', () => {
        render(<ActionChip label="Bagus" count={0} onClick={vi.fn()} />);

        expect(screen.getByRole('button').textContent).toBe('Bagus');
    });

    it('prints the count next to the label, in tabular-nums so the row does not jog', () => {
        render(<ActionChip label="Bagus" count={12} onClick={vi.fn()} />);

        const chip = screen.getByRole('button');
        expect(chip.textContent).toBe('Bagus12');
        expect(chip.querySelector('.tabular-nums').textContent).toBe('12');
    });

    /* A one-shot action announced as an unpressed toggle is a lie to a screen reader. */
    it('announces aria-pressed only for real toggles', () => {
        const { rerender } = render(<ActionChip label="Bagikan" onClick={vi.fn()} />);
        expect(screen.getByRole('button').hasAttribute('aria-pressed')).toBe(false);

        rerender(<ActionChip label="Favorit" pressed={false} onClick={vi.fn()} />);
        expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false');

        rerender(<ActionChip label="Favorit" pressed onClick={vi.fn()} />);
        expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true');
    });

    /*
     * ONE pressed appearance for the whole row. A per-chip tone prop is the door through which six
     * chips walk back out to being six different buttons — and the specific tone that must never
     * appear is the fault red: nothing in this row is a fault.
     */
    it('has exactly one pressed look, built from primary — never a fault colour', () => {
        const { rerender } = render(<ActionChip label="Bagus" onClick={vi.fn()} />);
        const idle = classesOf(screen.getByRole('button'));
        expect(idle).toContain('border-edge');
        expect(idle).toContain('text-content-muted');

        rerender(<ActionChip label="Bagus" pressed onClick={vi.fn()} />);
        const on = classesOf(screen.getByRole('button'));
        expect(on).toContain('border-primary');
        expect(on).toContain('text-primary');
        expect(on).not.toContain('border-edge');

        for (const cls of [...idle, ...on]) {
            expect(cls, `${cls}: status-fault is reserved for genuine faults`).not.toMatch(/status-fault/);
        }
    });

    /*
     * `--primary-color` is a bare CSS variable, so Tailwind cannot compute alpha for it:
     * `bg-primary/10` compiled to NOTHING and shipped that way, with the pressed state carrying
     * half its signal. `primary-100` is the pre-declared 10% tint and actually renders.
     */
    it('tints the pressed state with bg-primary-100, not the bg-primary/10 that compiles to nothing', () => {
        render(<ActionChip label="Bagus" pressed onClick={vi.fn()} />);

        const cls = classesOf(screen.getByRole('button'));
        expect(cls).toContain('bg-primary-100');
        expect(cls.join(' ')).not.toMatch(/bg-primary\/\d/);
    });

    /* Semantic tokens only — a raw grey or a deprecated ramp here would propagate to all six. */
    it('styles itself from semantic tokens only', () => {
        const { rerender } = render(<ActionChip label="Lapor" onClick={vi.fn()} />);
        const idle = classesOf(screen.getByRole('button')).join(' ');
        rerender(<ActionChip label="Lapor" pressed onClick={vi.fn()} />);
        const on = classesOf(screen.getByRole('button')).join(' ');

        for (const cls of [idle, on]) {
            expect(cls).not.toMatch(/(^|[\s:-])gray-\d/);
            expect(cls).not.toMatch(/(^|[\s:])(dark|light)-\d/);
        }
        expect(idle).toContain('rounded-control');
        expect(on).toContain('rounded-control');
    });

    /*
     * The ROW wraps; the CHIP does not. A chip refuses to shrink and refuses to break its own word,
     * which is what makes the wrap happen at a chip boundary instead of halfway through one:
     * truncating "Bermasalah" to "Berma…" would destroy the word to buy space a second line gives
     * away for free.
     */
    it('keeps a thumb-sized target and refuses to shrink or break its own word', () => {
        render(<ActionChip label="Bermasalah" onClick={vi.fn()} />);

        const cls = classesOf(screen.getByRole('button'));
        expect(cls).toContain('shrink-0');
        expect(cls).toContain('whitespace-nowrap');

        const floors = cls
            .map((c) => c.match(/min-h-\[(\d+)px\]$/))
            .filter(Boolean)
            .map((m) => Number(m[1]));
        expect(floors.length, 'chip declares no minimum height').toBeGreaterThan(0);
        for (const px of floors) {
            expect(px, 'touch targets are 36px and up — see docs/frontend-guide.md').toBeGreaterThanOrEqual(36);
        }
    });

    /*
     * A keyboard user has no hover to fall back on, and an icon-only chip gives them nothing else
     * to go on. The ring is declared in BASE so every chip gets it — asserting it here is what
     * stops a future "tidy" from stripping it from the shared string.
     */
    it('draws a visible focus ring on every chip, labelled or not', () => {
        const { rerender } = render(<ActionChip label="Bagikan" onClick={vi.fn()} />);
        expect(screen.getByRole('button').getAttribute('class')).toMatch(/focus-visible:ring-2/);

        rerender(<ActionChip compact label="Bagikan" onClick={vi.fn()} />);
        expect(screen.getByRole('button').getAttribute('class')).toMatch(/focus-visible:ring-2/);

        rerender(<ActionChip compact label="Area" href="/area/x" />);
        expect(screen.getByRole('link').getAttribute('class')).toMatch(/focus-visible:ring-2/);
    });
});

/*
 * `compact` is the whole point of the 2026-08-21 pass: it is what lets six actions sit on ONE line
 * of a 375px phone without any of them hiding behind a scroll. Everything below guards the price of
 * that — the name and the hit area — because those are what a later tidy-up quietly takes back.
 */
describe('ActionChip — compact: the word goes away, the meaning does not', () => {
    const labelSpanOf = (chip) => [...chip.querySelectorAll('span')].find((s) => s.textContent === 'Bagikan');

    it('hides only the label PIXELS below sm — the word stays in the DOM and in the name', () => {
        render(<ActionChip compact label="Bagikan" onClick={vi.fn()} ariaLabel="Bagikan kamera ini" />);

        const chip = screen.getByRole('button', { name: 'Bagikan kamera ini' });
        const span = labelSpanOf(chip);
        // `hidden sm:inline` — a CSS decision made before React exists. A JS window-width state
        // would flicker on first paint and make the markup depend on when a resize listener ran.
        expect(span.getAttribute('class')).toBe('hidden sm:inline');
        expect(chip.textContent).toBe('Bagikan');
    });

    it('keeps the label visible at every width when it is NOT compact', () => {
        render(<ActionChip label="Bagikan" onClick={vi.fn()} ariaLabel="Bagikan kamera ini" />);

        const span = labelSpanOf(screen.getByRole('button'));
        expect(span.getAttribute('class'), 'a labelled chip must never hide its word').toBeNull();
    });

    /*
     * The hit area goes UP when the label goes away — never down to match the ink. 44px is the
     * platform floor on both iOS and Android, and docs/frontend-guide.md records that the 26–30px
     * icon buttons elsewhere in this app were measurably unreliable for a thumb.
     */
    it('grows the touch target to a 44x44 square once it is icon-only', () => {
        render(<ActionChip compact icon={<svg />} label="Lapor" onClick={vi.fn()} />);

        const cls = classesOf(screen.getByRole('button'));
        expect(cls).toContain('min-h-[44px]');
        expect(cls).toContain('min-w-[44px]');
    });

    /* A labelled pill is ~90px of thumb-catching width already, so it does not need the square —
       and forcing one on it would widen the row that compact exists to narrow. */
    it('does not force the square onto a labelled chip', () => {
        render(<ActionChip icon={<svg />} label="Bagus" onClick={vi.fn()} />);

        const cls = classesOf(screen.getByRole('button'));
        expect(cls).toContain('min-h-[40px]');
        expect(cls).not.toContain('min-w-[44px]');
    });

    /*
     * The digits are hidden with the word — the chip has to stay a 44px square — but the count is
     * appended to the accessible name HERE, in the primitive, so hiding it stays a visual decision
     * rather than a loss of information: "Tandai kamera ini bermasalah, 2".
     */
    it('carries the count into the accessible name even while its digits are hidden', () => {
        render(
            <ActionChip
                compact
                label="Bermasalah"
                count={2}
                onClick={vi.fn()}
                ariaLabel="Tandai kamera ini bermasalah"
            />
        );

        const chip = screen.getByRole('button', { name: 'Tandai kamera ini bermasalah, 2' });
        expect(chip.querySelector('.tabular-nums').getAttribute('class')).toMatch(/\bhidden sm:inline\b/);
    });

    it('appends the count for a labelled chip too, so "Bagus, 4" is announced as one thing', () => {
        render(<ActionChip label="Bagus" count={4} onClick={vi.fn()} ariaLabel="Kamera ini bagus" />);

        expect(screen.getByRole('button', { name: 'Kamera ini bagus, 4' })).toBeTruthy();
    });

    /*
     * The name falls back to the visible word, so a compact chip can never end up nameless even if
     * a caller forgets `ariaLabel`. Nameless is the one outcome an icon-only control cannot survive.
     */
    it('never ends up nameless: the visible word is the fallback name', () => {
        render(<ActionChip compact icon={<svg />} label="Favorit" onClick={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Favorit' })).toBeTruthy();
    });

    /* The tooltip is the sighted visitor's only way to check an icon before committing to it. */
    it('passes the full sentence through to title, for the long-press tooltip', () => {
        render(
            <ActionChip
                compact
                label="Lapor"
                onClick={vi.fn()}
                ariaLabel="Laporkan masalah pada kamera ini"
                title="Laporkan masalah pada kamera ini"
            />
        );

        expect(screen.getByRole('button').getAttribute('title')).toBe('Laporkan masalah pada kamera ini');
    });

    /* Compact applies to the anchor form too — "Area" is the chip that navigates. */
    it('applies to an anchor exactly as it does to a button', () => {
        render(<ActionChip compact icon={<svg />} label="Area" href="/area/ds-dander" ariaLabel="Buka area" />);

        const chip = screen.getByRole('link', { name: 'Buka area' });
        expect(chip.tagName).toBe('A');
        expect(chip.getAttribute('href')).toBe('/area/ds-dander');
        const cls = classesOf(chip);
        expect(cls).toContain('min-h-[44px]');
        expect(cls).toContain('min-w-[44px]');
    });
});

describe('ActionChip — naming, disabling and the icon slot', () => {
    /*
     * Two controls a screen apart both said "Bagikan" — one for the camera, one for the shop item.
     * The chip has to be able to carry the label that tells them apart, for a screen reader and for
     * a long-press tooltip alike; visually the context does the work.
     */
    it('carries an aria-label and a title independent of the visible word', () => {
        render(
            <ActionChip
                label="Bagikan"
                onClick={vi.fn()}
                ariaLabel="Bagikan kamera ini"
                title="Bagikan kamera ini"
                testId="camera-action-share"
            />
        );

        const chip = screen.getByTestId('camera-action-share');
        expect(chip.textContent).toBe('Bagikan');
        expect(chip.getAttribute('aria-label')).toBe('Bagikan kamera ini');
        expect(chip.getAttribute('title')).toBe('Bagikan kamera ini');
    });

    it('does not act while a vote is in flight', () => {
        const onClick = vi.fn();
        render(<ActionChip label="Bagus" disabled onClick={onClick} />);

        const chip = screen.getByRole('button');
        expect(chip.disabled).toBe(true);
        fireEvent.click(chip);
        expect(onClick).not.toHaveBeenCalled();
    });

    it('renders the icon it was given, ahead of the label', () => {
        render(<ActionChip icon={<svg data-testid="ikon" />} label="Area" onClick={vi.fn()} />);

        const chip = screen.getByRole('button');
        expect(chip.firstChild).toBe(screen.getByTestId('ikon'));
        expect(chip.textContent).toBe('Area');
    });
});
