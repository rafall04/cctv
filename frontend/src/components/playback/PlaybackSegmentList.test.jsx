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
/*
 * Halaman playback punya TIGA pemilih segmen: stepper melangkah, timeline bisa diklik, daftar ini
 * bisa dipilih. Saat cuma ada satu segmen ketiganya menyatakan fakta yang sama, dan "Segmen 1 dari
 * 1" di stepper menyebutnya sekali lagi — empat kali, satu fakta, di tiga kartu besar.
 *
 * Yang dikunci di bawah bukan "kartunya lebih pendek", tapi bahwa melipat TIDAK menghilangkan
 * kemampuan: barisnya tetap ada, tetap bisa dipilih, dan tetap membawa ukuran berkas yang tidak
 * pernah diberitahu timeline.
 */
describe('PlaybackSegmentList melipat daftar berisi satu', () => {
    const SATU = [SEGMENTS[0]];

    it('melipat saat tepat satu segmen, karena tidak ada yang bisa dipilih', () => {
        const { container } = render(
            <PlaybackSegmentList segments={SATU} selectedSegment={null} onSegmentClick={vi.fn()} />,
        );

        expect(container.querySelector('details').open).toBe(false);
        expect(screen.getByText(/Segmen Rekaman \(1\)/)).not.toBeNull();
    });

    it('tetap terbuka saat ada lebih dari satu — di sana memilih berarti sesuatu', () => {
        const { container } = render(
            <PlaybackSegmentList segments={SEGMENTS} selectedSegment={null} onSegmentClick={vi.fn()} />,
        );

        expect(container.querySelector('details').open).toBe(true);
    });

    it('tetap terbuka saat KOSONG — pesan kosongnya adalah jawabannya', () => {
        const { container } = render(
            <PlaybackSegmentList segments={[]} selectedSegment={null} onSegmentClick={vi.fn()} />,
        );

        expect(container.querySelector('details').open).toBe(true);
        expect(screen.getByText('Belum ada recording tersedia')).not.toBeNull();
    });

    it('yang dilipat hanya tampilannya — barisnya tetap ada dan tetap bisa dipilih', () => {
        const onSegmentClick = vi.fn();
        render(<PlaybackSegmentList segments={SATU} selectedSegment={null} onSegmentClick={onSegmentClick} />);

        // Ukuran berkas hanya ada di daftar ini, tidak di timeline — ia tidak boleh hilang.
        expect(screen.getByText(/MB|GB/)).not.toBeNull();

        fireEvent.click(screen.getByText(/MB|GB/));
        expect(onSegmentClick).toHaveBeenCalledTimes(1);
    });
});
