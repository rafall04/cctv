// @vitest-environment jsdom

/*
 * Purpose: Prove the negative vote reaches the one audience that can act on it, and stays away
 *          from everyone else.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked adminService.
 * SideEffects: jsdom render only.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraFeedbackPanel from './CameraFeedbackPanel';
import { adminService } from '../../../services/adminService';

vi.mock('../../../services/adminService', () => ({
    adminService: { getCameraReactions: vi.fn() },
}));

const ROWS = [
    { id: 25, name: 'JEMBATAN A', areaName: 'KEC BOJONEGORO', likes: 2, dislikes: 30, lastVoteAt: '2026-08-02 10:00:00' },
    { id: 31, name: 'PASAR', areaName: 'KAB MAGETAN', likes: 0, dislikes: 4, lastVoteAt: '2026-08-02 09:00:00' },
    { id: 40, name: 'DISUKAI', areaName: 'KAB MAGETAN', likes: 12, dislikes: 0, lastVoteAt: '2026-08-02 08:00:00' },
];

beforeEach(() => {
    vi.clearAllMocks();
    adminService.getCameraReactions.mockResolvedValue({ success: true, data: ROWS });
});

describe('CameraFeedbackPanel', () => {
    it('lists the complained-about cameras with both sides of the count', async () => {
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText('2 kamera dikeluhkan pengunjung')).toBeTruthy();
        expect(screen.getByText('30 bermasalah')).toBeTruthy();
        expect(screen.getByText('2 bagus')).toBeTruthy();
        expect(screen.getByText('JEMBATAN A')).toBeTruthy();
    });

    /* A camera nobody has complained about is not a maintenance ticket. */
    it('leaves out cameras with no complaints at all', async () => {
        render(<CameraFeedbackPanel />);
        await screen.findByText('JEMBATAN A');

        expect(screen.queryByText('DISUKAI')).toBeNull();
    });

    it('renders nothing when nobody has complained', async () => {
        adminService.getCameraReactions.mockResolvedValue({
            success: true, data: [{ id: 1, name: 'OK', likes: 3, dislikes: 0 }],
        });
        const { container } = render(<CameraFeedbackPanel />);

        await waitFor(() => expect(adminService.getCameraReactions).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    /** A capped list that does not say it is capped reads as the whole story. */
    it('says so when the list is truncated', async () => {
        adminService.getCameraReactions.mockResolvedValue({
            success: true,
            data: Array.from({ length: 14 }, (_, i) => ({
                id: i + 1, name: `KAM ${i + 1}`, areaName: null, likes: 0, dislikes: 14 - i,
            })),
        });
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText(/Menampilkan 10 terburuk dari 14 kamera/)).toBeTruthy();
    });

    it('stays silent when the request fails', async () => {
        adminService.getCameraReactions.mockResolvedValue({ success: false, message: 'Sesi habis' });
        const { container } = render(<CameraFeedbackPanel />);

        await waitFor(() => expect(adminService.getCameraReactions).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });
});
