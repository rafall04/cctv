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
     * The row scrolls, it does not wrap: a chip must refuse to shrink and refuse to break its own
     * word, and it must stay thumb-sized at Android's font scaling. Truncating "Bermasalah" to
     * "Berma…" would destroy the word to save space a scrolling row does not need to save.
     */
    it('keeps a thumb-sized target and refuses to shrink or wrap', () => {
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
