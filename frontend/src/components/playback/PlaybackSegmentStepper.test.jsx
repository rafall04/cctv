// @vitest-environment jsdom

/*
 * Purpose: Prove stepping between segments works from under the player, and that "Sebelumnya" means
 *          earlier in time rather than one row up in a newest-first list.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * The direction is the easy thing to get backwards: the list above is sorted newest-first, so the
 * segment BEFORE the current one in time sits at a HIGHER index there. Getting it wrong would send
 * every viewer forwards when they asked to go back, which is exactly the kind of quiet defect a
 * layout change hides.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackSegmentStepper from './PlaybackSegmentStepper';

const seg = (id, hour) => ({
    id,
    start_time: `2026-08-02T0${hour}:00:00`,
    end_time: `2026-08-02T0${hour}:10:00`,
});

// Handed in newest-first, exactly as the page holds them.
const SEGMENTS = [seg(3, 9), seg(2, 8), seg(1, 7)];

function setup(selected = SEGMENTS[1], segments = SEGMENTS) {
    const onSegmentClick = vi.fn();
    render(
        <PlaybackSegmentStepper
            segments={segments}
            selectedSegment={selected}
            onSegmentClick={onSegmentClick}
        />,
    );
    return { onSegmentClick };
}

const prev = () => screen.getByRole('button', { name: 'Segmen sebelumnya (lebih lama)' });
const next = () => screen.getByRole('button', { name: 'Segmen berikutnya (lebih baru)' });

describe('PlaybackSegmentStepper direction', () => {
    it('steps BACK in time, not up the newest-first list', () => {
        const { onSegmentClick } = setup();

        fireEvent.click(prev());

        expect(onSegmentClick).toHaveBeenCalledWith(SEGMENTS[2]); // 07.00, the older one
    });

    it('steps FORWARD in time', () => {
        const { onSegmentClick } = setup();

        fireEvent.click(next());

        expect(onSegmentClick).toHaveBeenCalledWith(SEGMENTS[0]); // 09.00, the newer one
    });

    it('stops at the oldest segment instead of wrapping round', () => {
        setup(SEGMENTS[2]);

        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(false);
    });

    it('stops at the newest segment', () => {
        setup(SEGMENTS[0]);

        expect(next().disabled).toBe(true);
        expect(prev().disabled).toBe(false);
    });
});

describe('PlaybackSegmentStepper labelling', () => {
    it('names the segment being watched, so the buttons are not blind', () => {
        setup();

        expect(screen.getByText('08.00 - 08.10')).toBeTruthy();
    });

    it('counts newest-first, agreeing with the list below rather than contradicting it', () => {
        setup(SEGMENTS[0]);
        expect(screen.getByText(/Segmen 1 dari 3/)).toBeTruthy();
    });

    it('counts the oldest as last', () => {
        setup(SEGMENTS[2]);
        expect(screen.getByText(/Segmen 3 dari 3/)).toBeTruthy();
    });

    it('says what to do when nothing is selected yet, rather than showing a blank row', () => {
        setup(null);

        expect(screen.getByText('Pilih segmen di bawah')).toBeTruthy();
        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(true);
    });

    it('renders nothing at all when the camera has no recordings', () => {
        const { container } = render(
            <PlaybackSegmentStepper segments={[]} selectedSegment={null} onSegmentClick={vi.fn()} />,
        );

        expect(container.firstChild).toBeNull();
    });

    it('survives a selection that is not in the list, without stepping anywhere', () => {
        // Happens for a moment when the camera changes: the old segment outlives the new list.
        setup({ id: 99, start_time: '2026-08-02T05:00:00', end_time: '2026-08-02T05:10:00' });

        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(true);
    });
});
