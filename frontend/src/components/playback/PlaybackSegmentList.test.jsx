// @vitest-environment jsdom

/*
 * Purpose: Prove the list never states a count, or a verdict, before it has an answer.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library.
 * SideEffects: jsdom render only.
 *
 * "Segmen Rekaman (0)" plus "Belum ada recording tersedia" appeared while the fetch was still in
 * flight. Both read as a finished answer — this camera has nothing — when nothing had been asked
 * yet, which is exactly what made the page look either broken or empty at random.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import PlaybackSegmentList from './PlaybackSegmentList';

const SEGMENTS = [
    { id: 1, start_time: '2026-08-02T08:00:00', end_time: '2026-08-02T08:10:00', duration: 600, file_size: 73_000_000 },
    { id: 2, start_time: '2026-08-02T08:10:00', end_time: '2026-08-02T08:20:00', duration: 600, file_size: 73_000_000 },
];

describe('PlaybackSegmentList while waiting', () => {
    it('withholds both the count and the verdict', () => {
        render(<PlaybackSegmentList segments={[]} selectedSegment={null} onSegmentClick={vi.fn()} isLoading />);

        expect(screen.getByText('Memuat daftar rekaman...')).toBeTruthy();
        expect(screen.queryByText(/Segmen Rekaman \(0\)/)).toBeNull();
        expect(screen.queryByText('Belum ada recording tersedia')).toBeNull();
    });

    it('does not show a stale count either, when segments from another camera linger', () => {
        render(<PlaybackSegmentList segments={SEGMENTS} selectedSegment={null} onSegmentClick={vi.fn()} isLoading />);

        expect(screen.queryByText(/\(2\)/)).toBeNull();
    });
});

describe('PlaybackSegmentList once answered', () => {
    it('delivers the empty verdict only after the fetch is done', () => {
        render(<PlaybackSegmentList segments={[]} selectedSegment={null} onSegmentClick={vi.fn()} isLoading={false} />);

        expect(screen.getByText('Segmen Rekaman (0)')).toBeTruthy();
        expect(screen.getByText('Belum ada recording tersedia')).toBeTruthy();
    });

    it('lists the segments newest first and reports the count', () => {
        render(<PlaybackSegmentList segments={SEGMENTS} selectedSegment={SEGMENTS[1]} onSegmentClick={vi.fn()} />);

        expect(screen.getByText('Segmen Rekaman (2)')).toBeTruthy();
        const rows = screen.getAllByRole('button');
        expect(rows[0].textContent).toContain('08.10');
        expect(rows[0].getAttribute('aria-current')).toBe('true');
    });

    it('selects the segment that was clicked', () => {
        const onSegmentClick = vi.fn();
        render(<PlaybackSegmentList segments={SEGMENTS} selectedSegment={null} onSegmentClick={onSegmentClick} />);

        fireEvent.click(screen.getAllByRole('button')[1]);
        expect(onSegmentClick).toHaveBeenCalledWith(SEGMENTS[0]);
    });
});
