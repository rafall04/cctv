// @vitest-environment jsdom

/*
 * Purpose: Prove both halves of visitor feedback reach the one audience that can act on them, and
 *          that the panel stays out of the way when there is nothing to act on.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked adminService.
 * SideEffects: jsdom render only.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraFeedbackPanel from './CameraFeedbackPanel';
import { adminService } from '../../../services/adminService';

vi.mock('../../../services/adminService', () => ({
    adminService: {
        getCameraReports: vi.fn(),
        getCameraReactions: vi.fn(),
        updateCameraReport: vi.fn(),
    },
}));

const REPORTS = [
    {
        id: 9, cameraId: 16, cameraName: 'PEREMPATAN', areaName: 'KEC BOJONEGORO',
        category: 'kejadian', categoryLabel: 'Ada kejadian di rekaman',
        message: 'Serempetan motor', occurredAt: '2026-08-02T14:30',
        status: 'baru', createdAt: '2026-08-02 15:00:00',
    },
    {
        id: 8, cameraId: 25, cameraName: 'JEMBATAN', areaName: null,
        category: 'buram', categoryLabel: 'Gambar buram',
        message: null, occurredAt: null, status: 'selesai', createdAt: '2026-08-01 09:00:00',
    },
];

const REACTIONS = [
    { id: 25, name: 'JEMBATAN', areaName: 'KEC BOJONEGORO', likes: 2, dislikes: 30 },
    { id: 40, name: 'DISUKAI', areaName: null, likes: 12, dislikes: 0 },
];

const listed = (reports, open = 1) => ({
    success: true,
    data: { reports, summary: { total: reports.length, open, byStatus: {}, byCategory: {} } },
});
const rated = (cameras) => ({
    success: true,
    data: { cameras, totals: { cameras: cameras.length, rated: cameras.length, likes: 0, dislikes: 0 } },
});

const empty = () => {
    adminService.getCameraReports.mockResolvedValue(listed([], 0));
    adminService.getCameraReactions.mockResolvedValue(rated([]));
};

beforeEach(() => {
    vi.clearAllMocks();
    adminService.getCameraReports.mockResolvedValue(listed(REPORTS));
    adminService.getCameraReactions.mockResolvedValue(rated(REACTIONS));
});

describe('CameraFeedbackPanel — reports', () => {
    it('shows an open report with its camera, category and words', async () => {
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText('1 laporan belum ditutup')).toBeTruthy();
        expect(screen.getByText('PEREMPATAN')).toBeTruthy();
        expect(screen.getByText('Ada kejadian di rekaman')).toBeTruthy();
        expect(screen.getByText('Serempetan motor')).toBeTruthy();
    });

    /* The incident time is a wall-clock guess from a phone; it is shown as written, not reformatted. */
    it('states the incident time exactly as the reporter gave it', async () => {
        render(<CameraFeedbackPanel />);

        expect(await screen.findByRole('link', { name: '2026-08-02T14:30' })).toBeTruthy();
    });

    /*
     * The point of collecting occurred_at at all: one click opens admin playback on that moment,
     * instead of leaving the operator to scrub an archive for it. Admin playback, not public —
     * staff should land with full reach rather than the 10-minute preview.
     */
    it('turns the incident time into a link that opens playback there', async () => {
        render(<CameraFeedbackPanel />);

        const link = await screen.findByRole('link', { name: '2026-08-02T14:30' });
        const url = new URL(link.getAttribute('href'), 'https://example.test');
        expect(url.pathname).toBe('/admin/playback');
        expect(url.searchParams.get('cam')).toBe('16');
        expect(Number(url.searchParams.get('t'))).toBe(new Date('2026-08-02T14:30').getTime());
    });

    it('leaves an unparseable time as plain text rather than an arbitrary link', async () => {
        adminService.getCameraReports.mockResolvedValue({
            success: true,
            data: { reports: [{ ...REPORTS[0], occurredAt: 'kemarin sore' }], openCount: 1 },
        });
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText(/Kejadian sekitar:/)).toBeTruthy();
        expect(screen.queryByRole('link', { name: 'kemarin sore' })).toBeNull();
    });

    it('leaves already-closed reports out of the open list', async () => {
        render(<CameraFeedbackPanel />);
        await screen.findByText('PEREMPATAN');

        expect(screen.getByText('1 laporan belum ditutup')).toBeTruthy();
        expect(screen.queryByText('Gambar buram')).toBeNull();
    });

    it('closes a report and drops it from the list', async () => {
        adminService.updateCameraReport.mockResolvedValue({ success: true, data: { id: 9, status: 'selesai' } });
        render(<CameraFeedbackPanel />);
        await screen.findByText('PEREMPATAN');

        fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));

        await waitFor(() => expect(adminService.updateCameraReport).toHaveBeenCalledWith(9, 'selesai'));
        await waitFor(() => expect(screen.queryByText('PEREMPATAN')).toBeNull());
    });

    it('keeps the report listed when closing it fails', async () => {
        adminService.updateCameraReport.mockResolvedValue({ success: false, message: 'Sesi habis' });
        render(<CameraFeedbackPanel />);
        await screen.findByText('PEREMPATAN');

        fireEvent.click(screen.getByRole('button', { name: 'Selesai' }));

        await waitFor(() => expect(adminService.updateCameraReport).toHaveBeenCalled());
        expect(screen.getByText('PEREMPATAN')).toBeTruthy();
    });
});

describe('CameraFeedbackPanel — negative votes', () => {
    it('lists the complained-about cameras with both sides of the count', async () => {
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText('1 kamera ditandai bermasalah')).toBeTruthy();
        expect(screen.getByText('30 bermasalah')).toBeTruthy();
        expect(screen.getByText('2 bagus')).toBeTruthy();
    });

    it('leaves out cameras nobody has complained about', async () => {
        render(<CameraFeedbackPanel />);
        await screen.findByText('1 kamera ditandai bermasalah');

        expect(screen.queryByText('DISUKAI')).toBeNull();
    });

    /** A capped list that does not say it is capped reads as the whole story. */
    it('says so when the list is truncated', async () => {
        adminService.getCameraReports.mockResolvedValue(listed([], 0));
        adminService.getCameraReactions.mockResolvedValue(rated(
            Array.from({ length: 14 }, (_, i) => ({
                id: i + 1, name: `KAM ${i + 1}`, areaName: null, likes: 0, dislikes: 14 - i, total: 14 - i,
            })),
        ));
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText(/Menampilkan 5 terburuk dari 14 kamera/)).toBeTruthy();
    });

    /* The panel is deliberately partial; without these the caps would read as the whole story. */
    it('offers a way through to the full pages', async () => {
        render(<CameraFeedbackPanel />);

        expect(await screen.findByRole('link', { name: 'Buka semua laporan' })).toBeTruthy();
        expect(screen.getByRole('link', { name: 'Buka penilaian semua kamera' })).toBeTruthy();
    });

    /** The summary count comes from the server, not from the five rows that happen to be shown. */
    it('states the true open total even though it lists only a few', async () => {
        adminService.getCameraReports.mockResolvedValue(listed([REPORTS[0]], 12));
        render(<CameraFeedbackPanel />);

        expect(await screen.findByText('12 laporan belum ditutup')).toBeTruthy();
    });
});

describe('CameraFeedbackPanel — silence', () => {
    it('renders nothing when there is no open report and no complaint', async () => {
        empty();
        const { container } = render(<CameraFeedbackPanel />);

        await waitFor(() => expect(adminService.getCameraReports).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });

    it('stays silent when the requests fail', async () => {
        adminService.getCameraReports.mockResolvedValue({ success: false, message: 'Sesi habis' });
        adminService.getCameraReactions.mockResolvedValue({ success: false, message: 'Sesi habis' });
        const { container } = render(<CameraFeedbackPanel />);

        await waitFor(() => expect(adminService.getCameraReactions).toHaveBeenCalled());
        expect(container.innerHTML).toBe('');
    });
});
