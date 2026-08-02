// @vitest-environment jsdom

/*
 * Purpose: Prove the report queue page can be narrowed, paged and worked through without lying
 *          about how much is left.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked adminService + NotificationContext.
 * SideEffects: jsdom render only.
 *
 * The summary cases matter most: filters are what turn a queue into a blindfold, and the counts
 * beside them are the only thing that keeps an operator honest about what they have not looked at.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraReportsManagement from './CameraReportsManagement';
import { adminService } from '../services/adminService';

vi.mock('../services/adminService', () => ({
    adminService: { getCameraReports: vi.fn(), updateCameraReport: vi.fn() },
}));

const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => notify }));

const REPORT = {
    id: 9, cameraId: 16, cameraName: 'PEREMPATAN', areaName: 'KEC BOJONEGORO',
    category: 'kejadian', categoryLabel: 'Ada kejadian di rekaman',
    message: 'Serempetan motor di sisi utara', occurredAt: '2026-08-02T14:30',
    status: 'baru', createdAt: '2026-08-02 15:00:00',
};

const payload = (overrides = {}) => ({
    success: true,
    data: {
        reports: [REPORT],
        pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
        summary: {
            total: 14, open: 12,
            byStatus: { baru: 9, dibaca: 3, selesai: 2 },
            byCategory: { buram: 5, gelap: 1, mati: 3, arah: 0, kejadian: 4, lainnya: 1 },
        },
        categories: [
            { key: 'buram', label: 'Gambar buram' },
            { key: 'kejadian', label: 'Ada kejadian di rekaman' },
        ],
        cameras: [{ id: 16, name: 'PEREMPATAN', reports: 4 }],
        ...overrides,
    },
});

beforeEach(() => {
    vi.clearAllMocks();
    adminService.getCameraReports.mockResolvedValue(payload());
});

describe('CameraReportsManagement — the queue', () => {
    it('opens on what is still unfinished rather than on everything', async () => {
        render(<CameraReportsManagement />);

        await waitFor(() => expect(adminService.getCameraReports).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'open', page: 1 }),
        ));
    });

    it('shows the report with its camera, category and full text', async () => {
        render(<CameraReportsManagement />);

        expect(await screen.findByText('PEREMPATAN')).toBeTruthy();
        expect(screen.getByText('Ada kejadian di rekaman')).toBeTruthy();
        expect(screen.getByText('Serempetan motor di sisi utara')).toBeTruthy();
    });

    /* The point of storing occurred_at: one click lands on that moment in admin playback. */
    it('links the incident time into playback at that moment', async () => {
        render(<CameraReportsManagement />);

        const link = await screen.findByRole('link', { name: '2026-08-02T14:30' });
        const url = new URL(link.getAttribute('href'), 'https://example.test');
        expect(url.pathname).toBe('/admin/playback');
        expect(url.searchParams.get('cam')).toBe('16');
    });
});

describe('CameraReportsManagement — counts stay honest', () => {
    /*
     * The summary spans the whole table, not the filtered slice. Narrowing it would let a filter
     * quietly become a blindfold — "nothing open" while twelve wait under another tab.
     */
    it('reports totals for everything even while a filter is applied', async () => {
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');
        // "Belum ditutup" is both a summary label and a status tab; the summary one is the <dt>.
        const stat = (label) => screen.getAllByText(label)
            .find((el) => el.tagName === 'DT').nextElementSibling.textContent;

        fireEvent.click(screen.getByRole('button', { name: 'Baru' }));

        await waitFor(() => expect(adminService.getCameraReports).toHaveBeenLastCalledWith(
            expect.objectContaining({ status: 'baru' }),
        ));
        // Whole-table numbers, unchanged by the narrower view.
        expect(stat('Total')).toBe('14');
        expect(stat('Belum ditutup')).toBe('12');
    });

    it('names how many reports each category and camera actually has', async () => {
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');

        expect(screen.getByRole('option', { name: 'Gambar buram (5)' })).toBeTruthy();
        expect(screen.getByRole('option', { name: 'PEREMPATAN (4)' })).toBeTruthy();
    });

    /** A filter option that can only ever return nothing is a dead end, so it is not offered. */
    it('offers only cameras that have actually been reported', async () => {
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');

        expect(screen.getByRole('option', { name: 'Semua kamera (1 pernah dilapor)' })).toBeTruthy();
    });
});

describe('CameraReportsManagement — working through it', () => {
    it('marks a new report as read', async () => {
        adminService.updateCameraReport.mockResolvedValue({ success: true, data: { id: 9, status: 'dibaca' } });
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');

        fireEvent.click(screen.getByRole('button', { name: 'Tandai dibaca' }));

        await waitFor(() => expect(adminService.updateCameraReport).toHaveBeenCalledWith(9, 'dibaca'));
    });

    /*
     * Refetches rather than patching in place: closing a report while viewing "belum ditutup"
     * removes it from the current filter AND changes the counts above it.
     */
    it('reloads after closing so the list and the counts agree again', async () => {
        adminService.updateCameraReport.mockResolvedValue({ success: true, data: { id: 9, status: 'selesai' } });
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');
        const before = adminService.getCameraReports.mock.calls.length;

        fireEvent.click(screen.getByRole('button', { name: 'Tandai selesai' }));

        await waitFor(() => expect(adminService.getCameraReports.mock.calls.length).toBeGreaterThan(before));
    });

    /** Closing by mistake must be undoable — otherwise the report is gone from every default view. */
    it('can reopen a report that was already closed', async () => {
        adminService.getCameraReports.mockResolvedValue(payload({ reports: [{ ...REPORT, status: 'selesai' }] }));
        adminService.updateCameraReport.mockResolvedValue({ success: true, data: { id: 9, status: 'dibaca' } });
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');

        fireEvent.click(screen.getByRole('button', { name: 'Buka lagi' }));

        await waitFor(() => expect(adminService.updateCameraReport).toHaveBeenCalledWith(9, 'dibaca'));
    });

    it('keeps the row and explains when the change is refused', async () => {
        adminService.updateCameraReport.mockResolvedValue({ success: false, message: 'Sesi habis' });
        render(<CameraReportsManagement />);
        await screen.findByText('PEREMPATAN');

        fireEvent.click(screen.getByRole('button', { name: 'Tandai selesai' }));

        await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Gagal memperbarui', 'Sesi habis'));
        expect(screen.getByText('PEREMPATAN')).toBeTruthy();
    });
});

describe('CameraReportsManagement — empty and broken states', () => {
    it('tells an empty filter apart from an empty table', async () => {
        adminService.getCameraReports.mockResolvedValue(payload({
            reports: [],
            summary: { total: 14, open: 12, byStatus: {}, byCategory: {} },
        }));
        render(<CameraReportsManagement />);

        expect(await screen.findByText('Tidak ada laporan yang cocok dengan filter ini.')).toBeTruthy();
    });

    it('says plainly when nobody has ever reported anything', async () => {
        adminService.getCameraReports.mockResolvedValue(payload({
            reports: [],
            summary: { total: 0, open: 0, byStatus: {}, byCategory: {} },
        }));
        render(<CameraReportsManagement />);

        expect(await screen.findByText('Belum ada laporan sama sekali dari pengunjung.')).toBeTruthy();
    });

    it('surfaces a load failure instead of an empty queue', async () => {
        adminService.getCameraReports.mockResolvedValue({ success: false, message: 'Sesi habis' });
        render(<CameraReportsManagement />);

        expect(await screen.findByText('Sesi habis')).toBeTruthy();
    });
});
