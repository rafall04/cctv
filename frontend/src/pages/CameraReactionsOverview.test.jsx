// @vitest-environment jsdom

/*
 * Purpose: Prove the verdict page shows the WHOLE fleet, sorts it honestly, and never dresses an
 *          absence of votes up as a bad score.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked adminService.
 * SideEffects: jsdom render only.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraReactionsOverview from './CameraReactionsOverview';
import { adminService } from '../services/adminService';

vi.mock('../services/adminService', () => ({
    adminService: { getCameraReactions: vi.fn() },
}));

const CAMERAS = [
    { id: 25, name: 'JEMBATAN', areaName: 'KEC BOJONEGORO', enabled: true, likes: 2, dislikes: 30, total: 32, lastVoteAt: '2026-08-02 10:00:00' },
    { id: 16, name: 'PEREMPATAN', areaName: 'KEC BOJONEGORO', enabled: true, likes: 9, dislikes: 1, total: 10, lastVoteAt: '2026-08-02 09:00:00' },
    { id: 40, name: 'SARANGAN', areaName: 'KAB MAGETAN', enabled: false, likes: 0, dislikes: 0, total: 0, lastVoteAt: null },
];

const payload = (cameras = CAMERAS) => ({
    success: true,
    data: {
        cameras,
        totals: {
            cameras: cameras.length,
            rated: cameras.filter((c) => c.total > 0).length,
            likes: cameras.reduce((s, c) => s + c.likes, 0),
            dislikes: cameras.reduce((s, c) => s + c.dislikes, 0),
        },
    },
});

const rowNames = () => screen.getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent);

beforeEach(() => {
    vi.clearAllMocks();
    adminService.getCameraReactions.mockResolvedValue(payload());
});

describe('CameraReactionsOverview', () => {
    /*
     * The denominator is the whole point. A table sorted by complaints looks like a fleet-wide
     * verdict until you see it rests on two rated cameras out of three.
     */
    it('states how much of the fleet has been rated at all', async () => {
        render(<CameraReactionsOverview />);

        expect(await screen.findByText('2 dari 3')).toBeTruthy();
        expect(screen.getByText('Pernah dinilai')).toBeTruthy();
    });

    it('lists cameras nobody has voted on instead of hiding them', async () => {
        render(<CameraReactionsOverview />);

        expect(await screen.findByText('SARANGAN')).toBeTruthy();
    });

    /** No votes is an absence of a verdict; "0%" would be a verdict. */
    it('shows a dash rather than 0% for an unrated camera', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('SARANGAN');

        // Kamera, Area, Bagus, Bermasalah, Total, Positif, Suara terakhir, Status.
        const cells = within(screen.getByText('SARANGAN').closest('tr')).getAllByRole('cell');
        expect(cells[5].textContent).toBe('—');
        expect(cells[6].textContent).toBe('—');
        expect(within(screen.getByText('SARANGAN').closest('tr')).queryByText('0%')).toBeNull();
    });

    it('computes the positive share from the votes actually cast', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('PEREMPATAN');

        expect(within(screen.getByText('PEREMPATAN').closest('tr')).getByText('90%')).toBeTruthy();
    });

    it('opens on the worst camera first', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('JEMBATAN');

        expect(rowNames()[0]).toBe('JEMBATAN');
    });

    it('re-sorts when a column header is used, and announces it', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('JEMBATAN');

        fireEvent.click(screen.getByRole('button', { name: /Bagus/ }));

        await waitFor(() => expect(rowNames()[0]).toBe('SARANGAN'));
        expect(screen.getByRole('columnheader', { name: /Bagus/ }).getAttribute('aria-sort')).toBe('ascending');
    });

    it('narrows to a camera or an area by search', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('JEMBATAN');

        fireEvent.change(screen.getByLabelText('Cari kamera atau area'), { target: { value: 'magetan' } });

        await waitFor(() => expect(rowNames()).toEqual(['SARANGAN']));
    });

    it('can hide the cameras nobody has rated', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('SARANGAN');

        fireEvent.click(screen.getByLabelText('Hanya yang sudah dinilai'));

        await waitFor(() => expect(rowNames()).toEqual(['JEMBATAN', 'PEREMPATAN']));
    });

    /*
     * Read-only by design: the counts are public, so an operator who could edit them would put the
     * admin table and the visitor's page into open contradiction.
     */
    it('offers no way to change or delete a vote, and says why', async () => {
        render(<CameraReactionsOverview />);
        await screen.findByText('JEMBATAN');

        expect(screen.getByText(/tidak bisa diubah atau dihapus dari sini/)).toBeTruthy();
        expect(screen.queryByRole('button', { name: /hapus/i })).toBeNull();
    });

    it('surfaces a load failure instead of an empty table', async () => {
        adminService.getCameraReactions.mockResolvedValue({ success: false, message: 'Sesi habis' });
        render(<CameraReactionsOverview />);

        expect(await screen.findByText('Sesi habis')).toBeTruthy();
    });
});
