// @vitest-environment jsdom

/*
 * Purpose: Prove the day grid only offers days that actually hold footage, and marks them.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The native `<input type="date">` this replaced accepted any past date and answered with an empty
 * list. If these ever go green again, that failure is back.
 *
 * Runs are built from LOCAL parts and only then serialised, like the real coverage payload is read:
 * a literal UTC string here would assert a different calendar day on a machine outside WIB.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackDayCalendar from './PlaybackDayCalendar';
import { daysWithRecordings } from '../../utils/playbackDayRange';

const iso = (year, month, day, hour) => new Date(year, month, day, hour, 0, 0).toISOString();

/* The archive holds 1-3 Aug and 6 Aug 2026; 4-5 Aug is the hole between them. */
const DAYS = daysWithRecordings([
    { from: iso(2026, 7, 1, 9), to: iso(2026, 7, 3, 17) },
    { from: iso(2026, 7, 6, 7), to: iso(2026, 7, 6, 18) },
]);

/* The accessible name is "Kamis, 6 Agustus 2026 — ada rekaman", so anchor on the day number. */
const dayButton = (day) => screen.getByRole('button', { name: new RegExp(`\\b${day} Agustus 2026`) });

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 6, 9, 0, 0));
});

afterEach(() => {
    vi.useRealTimers();
});

describe('PlaybackDayCalendar', () => {
    it('marks a day that has footage and lets it be picked', () => {
        const onSelect = vi.fn();
        render(<PlaybackDayCalendar value="" days={DAYS} onSelect={onSelect} onClose={vi.fn()} />);

        const day = dayButton(2);
        expect(day.getAttribute('aria-label')).toContain('ada rekaman');
        expect(day.hasAttribute('disabled')).toBe(false);

        fireEvent.click(day);
        expect(onSelect).toHaveBeenCalledWith('2026-08-02');
    });

    it('disables a day inside the span that has no footage', () => {
        render(<PlaybackDayCalendar value="" days={DAYS} onSelect={vi.fn()} onClose={vi.fn()} />);

        // 4 Aug sits between two runs — the hole the coverage strip draws in red.
        const empty = dayButton(4);
        expect(empty.getAttribute('aria-label')).toContain('tidak ada rekaman');
        expect(empty.hasAttribute('disabled')).toBe(true);
    });

    it('disables the future even when the archive somehow claims it', () => {
        const withTomorrow = daysWithRecordings([{ from: iso(2026, 7, 6, 0), to: iso(2026, 7, 9, 0) }]);
        render(<PlaybackDayCalendar value="" days={withTomorrow} onSelect={vi.fn()} onClose={vi.fn()} />);

        expect(dayButton(7).hasAttribute('disabled')).toBe(true);
    });

    it('opens on the month holding the newest footage when nothing is selected yet', () => {
        render(<PlaybackDayCalendar value="" days={DAYS} onSelect={vi.fn()} onClose={vi.fn()} />);
        expect(screen.getByText('Agustus 2026')).toBeTruthy();
    });

    it('will not navigate past the archive', () => {
        render(<PlaybackDayCalendar value="" days={DAYS} onSelect={vi.fn()} onClose={vi.fn()} />);

        // Everything we hold is inside Aug 2026, so both directions are dead ends.
        expect(screen.getByLabelText('Bulan sebelumnya').hasAttribute('disabled')).toBe(true);
        expect(screen.getByLabelText('Bulan berikutnya').hasAttribute('disabled')).toBe(true);
    });

    it('keeps every past day pickable when no coverage map was supplied', () => {
        render(<PlaybackDayCalendar value="" days={new Set()} onSelect={vi.fn()} onClose={vi.fn()} />);

        // A scope that never receives coverage must not be locked out of its own dates.
        expect(dayButton(4).hasAttribute('disabled')).toBe(false);
        expect(dayButton(7).hasAttribute('disabled')).toBe(true);
    });
});
