// @vitest-environment jsdom

/*
 * Purpose: Prove the archive list stops repeating what the filter already says — once a single
 *          camera is picked, the name and area leave every row and appear once in the sticky day
 *          header instead, while a mixed list keeps them.
 * Caller: Vitest frontend suite for the admin archive page.
 * Deps: React Testing Library, mocked telegramArchiveLibraryService + NotificationContext.
 * SideEffects: Renders jsdom UI against mocked async service responses only.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramArchiveLibrary from './TelegramArchiveLibrary';

const {
    getSummary, listUploads, locate, streamUrl, dayBounds, notifyError, notifyWarning,
} = vi.hoisted(() => ({
    getSummary: vi.fn(),
    listUploads: vi.fn(),
    locate: vi.fn(),
    streamUrl: vi.fn((id) => `/stream/${id}`),
    dayBounds: vi.fn((date, edge) => (date ? `${date}T${edge === 'end' ? '23' : '00'}:00:00.000Z` : undefined)),
    notifyError: vi.fn(),
    notifyWarning: vi.fn(),
}));

vi.mock('../services/telegramArchiveLibraryService', () => ({
    default: { getSummary, listUploads, locate, streamUrl, dayBounds },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ error: notifyError, warning: notifyWarning }),
}));

const CAMERA_NAME = 'SIMPANG 3 AHMAD YANI - VETERAN';
const AREA_NAME = 'KEC BOJONEGORO DAN SEKITARNYA';

function segment(segmentId, cameraName, cameraId) {
    return {
        segmentId,
        cameraId,
        cameraName,
        areaName: AREA_NAME,
        filename: `2026080_${segmentId}.mp4`,
        fileSize: 73_800_000,
        status: 'ok',
        playable: true,
        recordedAt: '2026-08-01T06:40:00.000Z',
        recordedUntil: '2026-08-01T06:50:00.000Z',
        durationSeconds: 600,
        uploadedAt: '2026-08-01 06:51:00',
        groups: [],
    };
}

const SUMMARY = {
    total: 226,
    playable: 226,
    bytes: 1_000_000,
    cameras: [
        { id: 16, name: CAMERA_NAME, segments: 226 },
        { id: 41, name: 'SIMPANG 3 PASAR PLAOSAN', segments: 175 },
    ],
};

beforeEach(() => {
    vi.clearAllMocks();
    getSummary.mockResolvedValue(SUMMARY);
    locate.mockResolvedValue(null);
    listUploads.mockResolvedValue({
        items: [segment(1, CAMERA_NAME, 16), segment(2, 'SIMPANG 3 PASAR PLAOSAN', 41)],
        total: 401,
    });
});

/** YYYY-MM-DD for today in LOCAL time — the same basis the presets use. */
function todayLocal(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

describe('TelegramArchiveLibrary row density', () => {
    it('keeps camera and area on each row while the list mixes cameras', async () => {
        render(<TelegramArchiveLibrary />);

        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        const [firstRow] = screen.getAllByRole('listitem');
        expect(within(firstRow).getByText(CAMERA_NAME)).toBeTruthy();
        expect(within(firstRow).getByText(/KEC BOJONEGORO/)).toBeTruthy();
    });

    it('drops the repeated camera and area from rows once one camera is selected', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        listUploads.mockResolvedValue({ items: [segment(1, CAMERA_NAME, 16)], total: 226 });
        // The native <select> is gone: choosing a camera now means opening the picker dialog and
        // tapping its row, the same gesture as on the playback page.
        fireEvent.click(document.querySelector('[aria-haspopup="dialog"]'));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', {
            name: new RegExp(CAMERA_NAME),
        }));

        await waitFor(() => expect(listUploads).toHaveBeenCalledWith(
            expect.objectContaining({ cameraId: '16' }),
        ));

        await waitFor(() => {
            const [row] = screen.getAllByRole('listitem');
            // The name is gone from the ROW, not from the page — the day header still carries it.
            expect(within(row).queryByText(CAMERA_NAME)).toBeNull();
            expect(within(row).queryByText(/KEC BOJONEGORO/)).toBeNull();
        });

        // Still visible exactly once as scroll-surviving context, in the sticky day heading.
        expect(screen.getByRole('heading', { name: new RegExp(CAMERA_NAME) })).toBeTruthy();
    });
});

describe('TelegramArchiveLibrary range presets', () => {
    it('fills both date fields from LOCAL today, not a UTC-shifted day', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));

        const today = todayLocal();
        // Awaited, not asserted synchronously: the click changes filters, which kicks off a reload.
        // Asserting before that settles leaves React updating outside act() and muddies the suite.
        await waitFor(() => {
            expect(screen.getByLabelText('Dari tanggal').value).toBe(today);
            expect(screen.getByLabelText('Sampai tanggal').value).toBe(today);
        });
    });

    it('spans the last 7 days inclusive', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: '7 hari' }));

        await waitFor(() => {
            expect(screen.getByLabelText('Dari tanggal').value).toBe(todayLocal(-6));
            expect(screen.getByLabelText('Sampai tanggal').value).toBe(todayLocal(0));
        });
    });

    it('clears the range when the active preset is pressed again', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.click(screen.getByRole('button', { name: 'Kemarin' }));
        await waitFor(() => expect(screen.getByLabelText('Dari tanggal').value).toBe(todayLocal(-1)));

        fireEvent.click(screen.getByRole('button', { name: 'Kemarin' }));
        await waitFor(() => {
            expect(screen.getByLabelText('Dari tanggal').value).toBe('');
            expect(screen.getByLabelText('Sampai tanggal').value).toBe('');
        });
    });
});

describe('TelegramArchiveLibrary jump to time', () => {
    it('turns a hit on another page into that page instead of reporting nothing found', async () => {
        // Rows on screen are 06:40-06:50; 02:15 is elsewhere in the archive entirely.
        locate.mockResolvedValue({ segmentId: 4242, offset: 137, approximate: false });
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.change(screen.getByLabelText('Lompat ke jam'), { target: { value: '02:15' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cari' }));

        await waitFor(() => expect(locate).toHaveBeenCalled());
        // offset 137 at the default page size of 25 -> page index 5, i.e. "Hal. 6".
        await waitFor(() => expect(listUploads).toHaveBeenCalledWith(
            expect.objectContaining({ offset: 125, limit: 25 }),
        ));
        expect(notifyWarning).not.toHaveBeenCalled();
    });

    it('says so plainly when the archive holds nothing that early', async () => {
        locate.mockResolvedValue(null);
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.change(screen.getByLabelText('Lompat ke jam'), { target: { value: '02:15' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cari' }));

        await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith(
            'Tidak ketemu',
            expect.stringContaining('02:15'),
        ));
    });

    it('rejects a malformed time without calling the server', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        fireEvent.change(screen.getByLabelText('Lompat ke jam'), { target: { value: '99:99' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cari' }));

        await waitFor(() => expect(notifyWarning).toHaveBeenCalledWith(
            'Format jam salah',
            expect.any(String),
        ));
        expect(locate).not.toHaveBeenCalled();
    });
});

/*
 * Paging felt like a page reload and threw the view to the top. Neither was intended: the list was
 * being swapped for a 6-row skeleton, the document collapsed, and since the pagination sits at the
 * BOTTOM the browser clamped scroll to the new maximum. Nothing ever called scrollTo.
 */
describe('TelegramArchiveLibrary paging stability', () => {
    it('keeps the rows mounted while the next page loads, so the page cannot collapse', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
        const before = screen.getAllByRole('listitem').length;

        // A request that never settles: whatever is on screen during the fetch is what we assert.
        listUploads.mockReturnValue(new Promise(() => {}));
        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));

        await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
        expect(screen.getAllByRole('listitem').length).toBe(before);
    });

    it('does not refetch the summary on a page change — it depends on the filters only', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));
        await waitFor(() => expect(listUploads).toHaveBeenCalledWith(
            expect.objectContaining({ offset: 25 }),
        ));

        expect(getSummary).toHaveBeenCalledTimes(1);
    });

    it('refetches the summary when the filters DO change', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(1));

        fireEvent.click(screen.getByRole('button', { name: 'Hari ini' }));

        await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
    });

    it('lets only the newest request write, so a slow earlier page cannot reappear', async () => {
        render(<TelegramArchiveLibrary />);
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));

        let settleFirst;
        listUploads.mockReturnValueOnce(new Promise((resolve) => { settleFirst = resolve; }));
        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));

        listUploads.mockResolvedValueOnce({ items: [segment(99, CAMERA_NAME, 16)], total: 401 });
        fireEvent.click(screen.getByRole('button', { name: /Berikutnya/ }));
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(1));

        // The stale page-2 response lands last and must be ignored.
        settleFirst({ items: [segment(1, CAMERA_NAME, 16), segment(2, CAMERA_NAME, 16)], total: 401 });
        await waitFor(() => expect(screen.getAllByRole('listitem').length).toBe(1));
    });
});
