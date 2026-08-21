// @vitest-environment jsdom

/*
 * Purpose: Prove the one-tap verdict behaves for an anonymous visitor — and that it never puts an
 *          error, or a dislike tally, next to the video.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService.
 * SideEffects: jsdom render only.
 *
 * IT RENDERS CHIPS INTO SOMEONE ELSE'S ROW NOW
 * This used to be a bar of its own — a third stacked row of controls under the video on a phone. It
 * now returns a bare Fragment of two ActionChips that CameraDetailPanel drops into the single
 * scrolling action row. The data, the optimistic state and the undo are unchanged and still tested
 * here; what changed is that it must contribute NO wrapper of its own, and must hand the
 * "Tersimpan" hint upward instead of printing it inside a scroller where nobody would see it.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraReactionBar from './CameraReactionBar';
import cameraFeedbackService from '../../services/cameraFeedbackService';

vi.mock('../../services/cameraFeedbackService', () => ({
    default: { getReaction: vi.fn(), setReaction: vi.fn() },
}));

beforeEach(() => {
    vi.clearAllMocks();
    cameraFeedbackService.getReaction.mockResolvedValue({
        success: true, data: { likes: 4, dislikes: 2, myValue: 0 },
    });
});

describe('CameraReactionBar', () => {
    /*
     * Both totals are printed (owner's decision, 2026-08-02): showing praise while hiding
     * complaints would make the counter an advertisement rather than a measurement.
     */
    it('shows both counts and no vote of its own before the visitor taps', async () => {
        render(<CameraReactionBar cameraId={7} />);

        const like = await screen.findByRole('button', { name: 'Kamera ini bagus' });
        expect(like.getAttribute('aria-pressed')).toBe('false');
        expect(like.textContent).toContain('4');
        expect(screen.getByRole('button', { name: 'Kamera ini bermasalah' }).textContent).toContain('2');
    });

    /*
     * Two chips and nothing else. A wrapper here would be a second flex context inside the panel's
     * scrolling row, and the row's gap would stop applying between "Bermasalah" and "Bagikan" —
     * which is how three separate button rows started in the first place.
     */
    it('contributes two bare chips and no wrapper of its own', async () => {
        const { container } = render(<CameraReactionBar cameraId={7} />);
        await screen.findByRole('button', { name: 'Kamera ini bagus' });

        expect([...container.children].map((el) => el.tagName)).toEqual(['BUTTON', 'BUTTON']);
        expect([...container.children].map((el) => el.getAttribute('data-testid')))
            .toEqual(['camera-reaction-like', 'camera-reaction-dislike']);
    });

    it('sends the vote and shows the result the server returned', async () => {
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 2, myValue: 1 },
        });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, 1));
        const like = screen.getByRole('button', { name: 'Kamera ini bagus' });
        expect(like.getAttribute('aria-pressed')).toBe('true');
        expect(like.textContent).toContain('5');
    });

    /* The same button is the undo — there is no separate "batal" control to find. */
    it('withdraws the vote when the chosen side is tapped again', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 0, myValue: 1 },
        });
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 0, myValue: 0 },
        });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, 0));
    });

    it('records a problem report and shows how many others said the same', async () => {
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 3, myValue: -1 },
        });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bermasalah' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, -1));
        const dislike = screen.getByRole('button', { name: 'Kamera ini bermasalah' });
        expect(dislike.getAttribute('aria-pressed')).toBe('true');
        expect(dislike.textContent).toContain('3');
    });

    /*
     * "Bermasalah" is a control for REPORTING a problem, not a readout of one. Red is reserved for
     * a genuine fault; a chip that turns red because the visitor tapped it would claim the camera
     * is broken on the strength of one anonymous opinion.
     */
    it('never turns red — not idle, and not when the visitor has pressed it', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 3, myValue: -1 },
        });
        const { container } = render(<CameraReactionBar cameraId={7} />);

        const dislike = await screen.findByRole('button', { name: 'Kamera ini bermasalah' });
        expect(dislike.getAttribute('aria-pressed')).toBe('true');
        expect(container.innerHTML).not.toMatch(/status-fault/);
    });

    /* "0" would read as a verdict; the truth is that nobody has voted yet. */
    it('omits a count entirely at zero rather than printing 0', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 0, dislikes: 0, myValue: 0 },
        });
        render(<CameraReactionBar cameraId={7} />);

        const like = await screen.findByRole('button', { name: 'Kamera ini bagus' });
        expect(like.textContent).not.toMatch(/\d/);
        expect(screen.getByRole('button', { name: 'Kamera ini bermasalah' }).textContent).not.toMatch(/\d/);
    });

    /** It sits under a live player: a broken endpoint must not put an error beside the video. */
    it('renders nothing at all when the endpoint fails', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({ success: false, message: 'boom' });
        const { container } = render(<CameraReactionBar cameraId={7} />);

        await waitFor(() => expect(cameraFeedbackService.getReaction).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    /*
     * Emoji tidak mewarisi warna tombol: fon sistem menggambarnya dengan warnanya sendiri, jadi
     * saat tombol berpindah ke keadaan terpilih jempolnya tetap kuning dan setengah sinyal
     * keadaan itu hilang. Ikon SVG memakai currentColor. Tes ini menjaga keduanya.
     */
    it('memakai ikon SVG, bukan emoji, dan ikonnya mewarisi warna tombol', async () => {
        render(<CameraReactionBar cameraId={7} />);
        const bagus = await screen.findByRole('button', { name: 'Kamera ini bagus' });
        const bermasalah = screen.getByRole('button', { name: 'Kamera ini bermasalah' });

        for (const tombol of [bagus, bermasalah]) {
            const svg = tombol.querySelector('svg');
            expect(svg).not.toBeNull();
            expect(svg.getAttribute('stroke')).toBe('currentColor');
            expect(svg.getAttribute('aria-hidden')).toBe('true');
        }
        // Tidak ada emoji yang tersisa di dalam tombol.
        const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
        expect(emoji.test(bagus.textContent)).toBe(false);
        expect(emoji.test(bermasalah.textContent)).toBe(false);

        // Yang ke bawah adalah yang ke atas diputar; tanpa itu keduanya tampak sama.
        expect(bermasalah.querySelector('svg').getAttribute('class')).toContain('rotate-180');
        expect(bagus.querySelector('svg').getAttribute('class')).not.toContain('rotate-180');
    });

    it('re-reads when the popup moves to another camera', async () => {
        const { rerender } = render(<CameraReactionBar cameraId={7} />);
        await screen.findByTestId('camera-reaction-like');

        rerender(<CameraReactionBar cameraId={8} />);

        await waitFor(() => expect(cameraFeedbackService.getReaction).toHaveBeenCalledWith(8));
    });
});

/*
 * The hint cannot ride inside a horizontally scrolling row — it would sit ~220px to the right of
 * the chip that triggered it, off-screen on a 360px phone. So the bar reports "this visitor's vote
 * is recorded" upward and the panel prints the line under the row, where it is actually read.
 */
describe('CameraReactionBar — it tells the panel when to print "Tersimpan"', () => {
    it('reports no saved vote before the visitor taps', async () => {
        const onSavedChange = vi.fn();
        render(<CameraReactionBar cameraId={7} onSavedChange={onSavedChange} />);

        await screen.findByRole('button', { name: 'Kamera ini bagus' });
        expect(onSavedChange).toHaveBeenLastCalledWith(false);
    });

    it('reports a saved vote once the server confirms it', async () => {
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 2, myValue: 1 },
        });
        const onSavedChange = vi.fn();
        render(<CameraReactionBar cameraId={7} onSavedChange={onSavedChange} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(onSavedChange).toHaveBeenLastCalledWith(true));
    });

    it('takes the report back when the vote is withdrawn', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 0, myValue: 1 },
        });
        cameraFeedbackService.setReaction.mockResolvedValue({
            success: true, data: { likes: 4, dislikes: 0, myValue: 0 },
        });
        const onSavedChange = vi.fn();
        render(<CameraReactionBar cameraId={7} onSavedChange={onSavedChange} />);

        await waitFor(() => expect(onSavedChange).toHaveBeenLastCalledWith(true));
        fireEvent.click(screen.getByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(onSavedChange).toHaveBeenLastCalledWith(false));
    });

    /* A stale hint under a different camera's video would be a claim about a vote nobody cast. */
    it('reports nothing saved again when the popup moves to another camera', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 5, dislikes: 0, myValue: 1 },
        });
        const onSavedChange = vi.fn();
        const { rerender } = render(<CameraReactionBar cameraId={7} onSavedChange={onSavedChange} />);
        await waitFor(() => expect(onSavedChange).toHaveBeenLastCalledWith(true));

        cameraFeedbackService.getReaction.mockResolvedValue({
            success: true, data: { likes: 1, dislikes: 0, myValue: 0 },
        });
        rerender(<CameraReactionBar cameraId={8} onSavedChange={onSavedChange} />);

        await waitFor(() => expect(onSavedChange).toHaveBeenLastCalledWith(false));
    });

    /* The bar must survive a caller that has no use for the signal. */
    it('does not require the callback', async () => {
        render(<CameraReactionBar cameraId={7} />);

        expect(await screen.findByRole('button', { name: 'Kamera ini bagus' })).toBeTruthy();
    });
});
