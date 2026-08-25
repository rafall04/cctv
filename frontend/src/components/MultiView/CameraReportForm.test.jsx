// @vitest-environment jsdom

/*
 * Purpose: Prove the report form asks for what the operator needs, stays out of the way until
 *          wanted, and never lets a half-typed report follow the visitor to another camera.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked cameraFeedbackService.
 * SideEffects: jsdom render only.
 *
 * THE TRIGGER LEFT, THE FORM STAYED — 2026-08-21
 * Opening this used to be an underlined "Laporkan masalah pada kamera ini" on a line of its own,
 * the third stacked row of controls under the video. The trigger is now the "Lapor" chip in
 * CameraDetailPanel's single action row, so `open` arrives as a prop and closing is a call to
 * `onClose`. Everything the form itself does — categories, incident time, submit, the refusal
 * message, the reset on camera change — is unchanged, and every one of those tests is still here.
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

/* Open it the way the panel does, and wait for the categories to land. */
const renderOpen = async (props = {}) => {
    const utils = render(<CameraReportForm cameraId={16} open onClose={vi.fn()} {...props} />);
    await screen.findByRole('button', { name: 'Gambar buram' });
    return utils;
};

beforeEach(() => {
    vi.clearAllMocks();
    cameraFeedbackService.getReportCategories.mockResolvedValue({ success: true, data: CATEGORIES });
    cameraFeedbackService.submitReport.mockResolvedValue({ success: true, message: 'Laporan terkirim. Terima kasih.' });
});

describe('CameraReportForm', () => {
    /*
     * The page exists to show a picture; an always-open form pushes the video down the phone. The
     * closed form now renders NOTHING — the chip in the row above is the trigger.
     *
     * NOTE: this test must stay first in the file. The module caches the category list for the
     * whole session (it is identical for every visitor), so only the first test in a fresh module
     * registry can observe the cold-cache fetch.
     */
    it('renders nothing and fetches nothing until the panel opens it, then fetches once', async () => {
        const { rerender, container } = render(<CameraReportForm cameraId={16} onClose={vi.fn()} />);

        expect(container.innerHTML).toBe('');
        expect(cameraFeedbackService.getReportCategories).not.toHaveBeenCalled();

        rerender(<CameraReportForm cameraId={16} open onClose={vi.fn()} />);
        await screen.findByRole('button', { name: 'Gambar buram' });
        expect(cameraFeedbackService.getReportCategories).toHaveBeenCalledTimes(1);

        // The list never changes within a session, so reopening must not re-fetch it.
        rerender(<CameraReportForm cameraId={16} onClose={vi.fn()} />);
        rerender(<CameraReportForm cameraId={16} open onClose={vi.fn()} />);
        await screen.findByRole('button', { name: 'Gambar buram' });
        expect(cameraFeedbackService.getReportCategories).toHaveBeenCalledTimes(1);
    });

    it('sends the chosen category with the report', async () => {
        await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        await waitFor(() => expect(cameraFeedbackService.submitReport).toHaveBeenCalledWith(16, {
            category: 'buram', message: null, occurredAt: null,
        }));
    });

    it('will not submit before a category is chosen', async () => {
        await renderOpen();

        expect(screen.getByRole('button', { name: 'Kirim' }).disabled).toBe(true);
    });

    it('carries the free-text keterangan through, trimmed', async () => {
        await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));
        fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: '  lensa berembun  ' } });

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        await waitFor(() => expect(cameraFeedbackService.submitReport).toHaveBeenCalledWith(16, {
            category: 'buram', message: 'lensa berembun', occurredAt: null,
        }));
    });

    /* A blurry lens does not happen at 14.30 — only an incident has a time worth asking for. */
    it('asks when it happened only for an incident', async () => {
        await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));

        expect(screen.queryByLabelText(/Perkiraan waktu kejadian/)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Ada kejadian di rekaman' }));
        expect(screen.getByLabelText(/Perkiraan waktu kejadian/)).toBeTruthy();
    });

    it('carries the incident time through to the report', async () => {
        await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Ada kejadian di rekaman' }));
        fireEvent.change(screen.getByLabelText(/Perkiraan waktu kejadian/), { target: { value: '2026-08-02T14:30' } });

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        await waitFor(() => expect(cameraFeedbackService.submitReport).toHaveBeenCalledWith(16, {
            category: 'kejadian', message: null, occurredAt: '2026-08-02T14:30',
        }));
    });

    it('tells the visitor their words are not published', async () => {
        await renderOpen();

        expect(screen.getByText(/hanya dibaca pengelola, tidak ditampilkan di halaman/)).toBeTruthy();
    });

    it('confirms and closes the form once the report lands', async () => {
        const onClose = vi.fn();
        await renderOpen({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        expect(await screen.findByText('Laporan terkirim. Terima kasih.')).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Kirim' })).toBeNull();
        // The panel owns `open`, so closing means telling the panel — the chip un-presses with it.
        expect(onClose).toHaveBeenCalled();
    });

    /*
     * Reopening after a send starts clean: the thank-you belongs to the report that was sent, and
     * leaving it up would turn the chip into a dead control for anyone with a second thing to
     * report on the same camera.
     */
    it('starts clean when the chip is used again after a send', async () => {
        const { rerender } = await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));
        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));
        await screen.findByText('Laporan terkirim. Terima kasih.');

        rerender(<CameraReportForm cameraId={16} onClose={vi.fn()} />);
        rerender(<CameraReportForm cameraId={16} open onClose={vi.fn()} />);

        expect(await screen.findByRole('button', { name: 'Kirim' })).toBeTruthy();
        expect(screen.queryByText('Laporan terkirim. Terima kasih.')).toBeNull();
    });

    /* "Batal" is the second way out, and it goes through the same door the chip does. */
    it('hands closing back to the panel when the visitor cancels', async () => {
        const onClose = vi.fn();
        await renderOpen({ onClose });

        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

        expect(onClose).toHaveBeenCalledTimes(1);
    });

    /** The server's message names what to fix; a generic failure would throw that away. */
    it('keeps the form open and shows the server reason on refusal', async () => {
        cameraFeedbackService.submitReport.mockResolvedValue({
            success: false, message: 'Terlalu banyak laporan dari perangkat ini. Coba lagi nanti.',
        });
        const onClose = vi.fn();
        await renderOpen({ onClose });
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));

        fireEvent.click(screen.getByRole('button', { name: 'Kirim' }));

        expect((await screen.findByRole('alert')).textContent).toMatch(/Terlalu banyak laporan/);
        expect(screen.getByRole('button', { name: 'Kirim' })).toBeTruthy();
        expect(onClose).not.toHaveBeenCalled();
    });

    /* A half-typed report about one feed must never be submitted against a different one. */
    it('resets its answers when the popup moves to another camera', async () => {
        const { rerender } = await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Gambar buram' }));
        fireEvent.change(screen.getByLabelText(/Keterangan/), { target: { value: 'gambar hitam' } });
        expect(screen.getByRole('button', { name: 'Kirim' }).disabled).toBe(false);

        rerender(<CameraReportForm cameraId={25} open onClose={vi.fn()} />);

        await waitFor(() => expect(screen.getByRole('button', { name: 'Kirim' }).disabled).toBe(true));
        expect(screen.getByLabelText(/Keterangan/).value).toBe('');
        expect(screen.getByRole('button', { name: 'Gambar buram' }).getAttribute('aria-pressed')).toBe('false');
    });

    /*
     * Semantic tokens only, and no fault red: a visitor filling in a report has not established
     * that anything is broken. The refusal message is a warning, which is what status-warn is for.
     */
    it('dresses itself in semantic tokens and never claims a fault', async () => {
        const { container } = await renderOpen();

        expect(container.innerHTML).not.toMatch(/status-fault/);
        expect(container.innerHTML).not.toMatch(/(^|[\s"':-])gray-\d/);
        expect(container.querySelector('form').getAttribute('class')).toContain('border-edge');
        expect(container.querySelector('form').getAttribute('class')).toContain('bg-surface-sunken');
    });
});

/*
 * Safari iOS zooms the whole page in whenever a focused input/textarea is under 16px, and this
 * form lives inside the public video popup — a visitor reporting an incident cannot redo the
 * moment after pinching back out. Both controls ran at text-xs (12px) until 2026-08.
 */
describe('CameraReportForm on a phone', () => {
    it('keeps every control at the 16px floor, shrinking only from sm up', async () => {
        await renderOpen();
        fireEvent.click(screen.getByRole('button', { name: 'Ada kejadian di rekaman' }));

        for (const control of [
            screen.getByLabelText(/Perkiraan waktu kejadian/),
            screen.getByLabelText(/Keterangan/),
        ]) {
            const cls = control.getAttribute('class');
            expect(cls).toContain('text-base');
            expect(cls).toContain('sm:text-sm');
            expect(cls).not.toMatch(/(^|\s)text-xs(\s|$)/);
        }
    });
});
