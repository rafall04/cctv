// @vitest-environment jsdom

/*
 * Purpose: Prove the report form asks for what the operator needs, stays out of the way until
 *          wanted, and never lets a half-typed report follow the visitor to another camera.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService.
 * SideEffects: jsdom render only.
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CameraReportForm from './CameraReportForm';
import cameraFeedbackService from '../../services/cameraFeedbackService';

vi.mock('../../services/cameraFeedbackService', () => ({
    default: { getReportCategories: vi.fn(), submitReport: vi.fn() },
}));

const CATEGORIES = [
    { key: 'buram', label: 'Gambar buram' },
    { key: 'kejadian', label: 'Ada kejadian di rekaman' },
    { key: 'lainnya', label: 'Lainnya' },
];

const openForm = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Laporkan masalah pada kamera ini' }));
    return screen.findByRole('button', { name: 'Gambar buram' });
};

beforeEach(() => {
    vi.clearAllMocks();
    cameraFeedbackService.getReportCategories.mockResolvedValue({ success: true, data: CATEGORIES });
    cameraFeedbackService.submitReport.mockResolvedValue({ success: true, message: 'Laporan terkirim. Terima kasih.' });
});

describe('CameraReportForm', () => {
    /* The page exists to show a picture; an always-open form pushes the video down the phone. */
    it('stays collapsed until the visitor asks for it', () => {
        render(<CameraReportForm cameraId={16} />);

        expect(screen.getByRole('button', { name: 'Laporkan masalah pada kamera ini' })).toBeTruthy();
        expect(cameraFeedbackService.getReportCategories).not.toHaveBeenCalled();
    });

    it('sends the chosen category with the report', async () => {
        render(<CameraReportForm cameraId={16} />);
        fireEvent.click(await openForm());

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        await waitFor(() => expect(cameraFeedbackService.submitReport).toHaveBeenCalledWith(16, {
            category: 'buram', message: null, occurredAt: null,
        }));
    });

    it('will not submit before a category is chosen', async () => {
        render(<CameraReportForm cameraId={16} />);
        await openForm();

        expect(screen.getByRole('button', { name: 'Kirim' }).disabled).toBe(true);
    });

    /* A blurry lens does not happen at 14.30 — only an incident has a time worth asking for. */
    it('asks when it happened only for an incident', async () => {
        render(<CameraReportForm cameraId={16} />);
        fireEvent.click(await openForm());

        expect(screen.queryByLabelText(/Perkiraan waktu kejadian/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Ada kejadian di rekaman' }));
        expect(screen.getByLabelText(/Perkiraan waktu kejadian/)).toBeTruthy();
    });

    it('carries the incident time through to the report', async () => {
        render(<CameraReportForm cameraId={16} />);
        await openForm();
        fireEvent.click(screen.getByRole('button', { name: 'Ada kejadian di rekaman' }));
        fireEvent.change(screen.getByLabelText(/Perkiraan waktu kejadian/), { target: { value: '2026-08-02T14:30' } });

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        await waitFor(() => expect(cameraFeedbackService.submitReport).toHaveBeenCalledWith(16, {
            category: 'kejadian', message: null, occurredAt: '2026-08-02T14:30',
        }));
    });

    it('tells the visitor their words are not published', async () => {
        render(<CameraReportForm cameraId={16} />);
        await openForm();

        expect(screen.getByText(/hanya dibaca pengelola, tidak ditampilkan di halaman/)).toBeTruthy();
    });

    it('confirms and closes the form once the report lands', async () => {
        render(<CameraReportForm cameraId={16} />);
        fireEvent.click(await openForm());

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        expect(await screen.findByText('Laporan terkirim. Terima kasih.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Kirim' })).toBeNull();
    });

    /** The server's message names what to fix; a generic failure would throw that away. */
    it('keeps the form open and shows the server reason on refusal', async () => {
        cameraFeedbackService.submitReport.mockResolvedValue({
            success: false, message: 'Terlalu banyak laporan dari perangkat ini. Coba lagi nanti.',
        });
        render(<CameraReportForm cameraId={16} />);
        fireEvent.click(await openForm());

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        expect((await screen.findByRole('alert')).textContent).toMatch(/Terlalu banyak laporan/);
        expect(screen.getByRole('button', { name: 'Kirim' })).toBeTruthy();
    });

    /* A half-typed report about one feed must never be submitted against a different one. */
    it('resets itself when the popup moves to another camera', async () => {
        const { rerender } = render(<CameraReportForm cameraId={16} />);
        fireEvent.click(await openForm());

        rerender(<CameraReportForm cameraId={25} />);

        expect(screen.getByRole('button', { name: 'Laporkan masalah pada kamera ini' })).toBeTruthy();
    });
});
