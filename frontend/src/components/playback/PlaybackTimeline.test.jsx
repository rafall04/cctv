// @vitest-environment jsdom

/*
 * Purpose: Lock what the timeline calls a hole, and what it refuses to.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, the pure geometry builder.
 * SideEffects: jsdom render only.
 *
 * Red on this bar means "there is no footage of that moment" — the single most consequential claim
 * the playback page makes. Two ways it lied in production, both covered here: a null `end_time`
 * parsed as the epoch and invented a 1.78-billion-second hole, and the archive query dropped its
 * newest rows so 42-63 real hours were painted as missing.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackTimeline, { buildTimelineGeometry } from './PlaybackTimeline';

const at = (hhmm) => `2026-08-06T${hhmm}:00.000Z`;

const segment = (id, from, to, extra = {}) => ({
    id,
    start_time: at(from),
    end_time: to === null ? null : at(to),
    duration: 600,
    ...extra,
});

describe('buildTimelineGeometry', () => {
    it('marks a real hole between two clips', () => {
        const geometry = buildTimelineGeometry([
            segment(1, '01:00', '01:10'),
            segment(2, '03:00', '03:10'),
        ]);

        expect(geometry.gaps).toHaveLength(1);
        expect(geometry.gaps[0].minutes).toBe(110);
    });

    it('stays quiet across a seam that is only timer rounding', () => {
        const geometry = buildTimelineGeometry([
            { id: 1, start_time: '2026-08-06T01:00:00.000Z', end_time: '2026-08-06T01:10:00.000Z', duration: 600 },
            { id: 2, start_time: '2026-08-06T01:10:20.000Z', end_time: '2026-08-06T01:20:20.000Z', duration: 600 },
        ]);

        expect(geometry.gaps).toEqual([]);
    });

    it('does not invent a hole from a missing end_time', () => {
        // Eight archived rows on production carry a null end. Read as the epoch, this produced a
        // gap of 1.78 billion seconds and a band positioned at left:-66000%.
        const geometry = buildTimelineGeometry([
            segment(1, '01:00', null),
            segment(2, '01:10', '01:20'),
        ]);

        expect(geometry.gaps).toEqual([]);
        expect(geometry.bands.every((band) => band.left >= 0 && band.left <= 100)).toBe(true);
        expect(geometry.bands.every((band) => band.width >= 0)).toBe(true);
    });

    it('falls back to start + duration when the end is missing but the length is known', () => {
        const geometry = buildTimelineGeometry([
            segment(1, '01:00', null, { duration: 600 }),
            segment(2, '02:00', '02:10'),
        ]);

        // 01:10 -> 02:00 is a real 50-minute hole, provable from the duration.
        expect(geometry.gaps).toHaveLength(1);
        expect(geometry.gaps[0].minutes).toBe(50);
    });

    it('orders by time regardless of the order it was handed', () => {
        const geometry = buildTimelineGeometry([
            segment(3, '03:00', '03:10'),
            segment(1, '01:00', '01:10'),
            segment(2, '02:00', '02:10'),
        ]);

        expect(geometry.bands.map((band) => band.segment.id)).toEqual([1, 2, 3]);
    });

    it('answers with an empty range rather than throwing on no segments', () => {
        expect(buildTimelineGeometry([])).toEqual({ start: null, end: null, duration: 0, bands: [], gaps: [] });
    });
});

describe('PlaybackTimeline', () => {
    const formatTimestamp = (value) => String(value);

    it('renders nothing at all when there is no footage to place', () => {
        const { container } = render(
            <PlaybackTimeline
                segments={[]}
                selectedSegment={null}
                onSegmentClick={vi.fn()}
                onTimelineClick={vi.fn()}
                formatTimestamp={formatTimestamp}
            />,
        );

        expect(container.firstChild).toBeNull();
    });

    it('draws the hole so an operator cannot mistake it for continuous footage', () => {
        render(
            <PlaybackTimeline
                segments={[segment(1, '01:00', '01:10'), segment(2, '03:00', '03:10')]}
                selectedSegment={null}
                onSegmentClick={vi.fn()}
                onTimelineClick={vi.fn()}
                formatTimestamp={formatTimestamp}
            />,
        );

        expect(screen.getByTitle('Hilang: 110 menit')).toBeTruthy();
    });
});
