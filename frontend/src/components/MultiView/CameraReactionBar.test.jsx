// @vitest-environment jsdom

/*
 * Purpose: Prove the one-tap verdict behaves for an anonymous visitor — and that it never puts an
 *          error, or a dislike tally, next to the video.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService.
 * SideEffects: jsdom render only.
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
    cameraFeedbackService.getReaction.mockResolvedValue({ success: true, data: { likes: 4, myValue: 0 } });
});

describe('CameraReactionBar', () => {
    it('shows the like count and no vote of its own before the visitor taps', async () => {
        render(<CameraReactionBar cameraId={7} />);

        const like = await screen.findByRole('button', { name: 'Kamera ini bagus' });
        expect(like.getAttribute('aria-pressed')).toBe('false');
        expect(like.textContent).toContain('4');
    });

    it('sends the vote and shows the result the server returned', async () => {
        cameraFeedbackService.setReaction.mockResolvedValue({ success: true, data: { likes: 5, myValue: 1 } });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, 1));
        const like = screen.getByRole('button', { name: 'Kamera ini bagus' });
        expect(like.getAttribute('aria-pressed')).toBe('true');
        expect(like.textContent).toContain('5');
    });

    /* The same button is the undo — there is no separate "batal" control to find. */
    it('withdraws the vote when the chosen side is tapped again', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({ success: true, data: { likes: 5, myValue: 1 } });
        cameraFeedbackService.setReaction.mockResolvedValue({ success: true, data: { likes: 4, myValue: 0 } });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bagus' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, 0));
    });

    it('records a problem report without printing a tally for it', async () => {
        cameraFeedbackService.setReaction.mockResolvedValue({ success: true, data: { likes: 4, myValue: -1 } });
        render(<CameraReactionBar cameraId={7} />);

        fireEvent.click(await screen.findByRole('button', { name: 'Kamera ini bermasalah' }));

        await waitFor(() => expect(cameraFeedbackService.setReaction).toHaveBeenCalledWith(7, -1));
        const dislike = screen.getByRole('button', { name: 'Kamera ini bermasalah' });
        expect(dislike.getAttribute('aria-pressed')).toBe('true');
        // The visitor is never shown how many others said the same.
        expect(dislike.textContent).not.toMatch(/\d/);
    });

    /* A fresh install would otherwise show a row of zeroes, reading as "nobody likes anything". */
    it('omits the count entirely at zero rather than printing 0', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({ success: true, data: { likes: 0, myValue: 0 } });
        render(<CameraReactionBar cameraId={7} />);

        const like = await screen.findByRole('button', { name: 'Kamera ini bagus' });
        expect(like.textContent).not.toMatch(/\d/);
    });

    /** It sits under a live player: a broken endpoint must not put an error beside the video. */
    it('renders nothing at all when the endpoint fails', async () => {
        cameraFeedbackService.getReaction.mockResolvedValue({ success: false, message: 'boom' });
        const { container } = render(<CameraReactionBar cameraId={7} />);

        await waitFor(() => expect(cameraFeedbackService.getReaction).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    it('re-reads when the popup moves to another camera', async () => {
        const { rerender } = render(<CameraReactionBar cameraId={7} />);
        await screen.findByTestId('camera-reaction-bar');

        rerender(<CameraReactionBar cameraId={8} />);

        await waitFor(() => expect(cameraFeedbackService.getReaction).toHaveBeenCalledWith(8));
    });
});
