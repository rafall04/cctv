// @vitest-environment jsdom

/*
 * Purpose: Prove the whole-range strip still tells the truth about days the list is not showing.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * This strip is the reason narrowing the list to one day is safe. If it ever stopped drawing the
 * holes, the page would be back to the failure that started all of this: 61 hours of footage
 * missing from view with nothing on screen saying so.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackCoverageStrip from './PlaybackCoverageStrip';
import { localDayRange } from '../../utils/playbackDayRange';

const COVERAGE = {
    runs: [
        { from: '2026-08-01T00:00:00.000Z', to: '2026-08-03T10:30:00.000Z' },
        { from: '2026-08-06T00:20:00.000Z', to: '2026-08-06T11:00:00.000Z' },
    ],
};

const range = localDayRange(new Date(2026, 7, 6));

describe('PlaybackCoverageStrip', () => {
    it('draws the hole between two runs and names its length', () => {
        render(<PlaybackCoverageStrip coverage={COVERAGE} range={range} onRangeChange={vi.fn()} />);

        // 2026-08-03T10:30Z -> 2026-08-06T00:20Z is 61.8 hours.
        expect(screen.getByTitle('Tidak ada rekaman: 61.8 jam')).toBeTruthy();
    });

    it('renders nothing when there is no coverage to describe', () => {
        const { container } = render(
            <PlaybackCoverageStrip coverage={{ runs: [] }} range={range} onRangeChange={vi.fn()} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('ignores a run whose bounds cannot be placed rather than drawing it at the epoch', () => {
        const { container } = render(
            <PlaybackCoverageStrip
                coverage={{ runs: [{ from: null, to: '2026-08-06T11:00:00.000Z' }] }}
                range={range}
                onRangeChange={vi.fn()}
            />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('asks for a whole local day when the strip is clicked', () => {
        const onRangeChange = vi.fn();
        render(<PlaybackCoverageStrip coverage={COVERAGE} range={range} onRangeChange={onRangeChange} />);

        const strip = screen.getByLabelText(/Peta seluruh rekaman/);
        strip.getBoundingClientRect = () => ({ left: 0, width: 200 });
        fireEvent.click(strip, { clientX: 0 });

        expect(onRangeChange).toHaveBeenCalledTimes(1);
        expect(onRangeChange.mock.calls[0][0].key).toBe('day:2026-08-01');
    });
});
