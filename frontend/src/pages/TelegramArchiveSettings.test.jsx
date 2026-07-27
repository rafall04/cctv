// @vitest-environment jsdom

/*
 * Purpose: Prove the Telegram archive admin form actually works — scope switching swaps the right
 *          picker, the chat-id check runs and invalidates when edited, create/edit/toggle/delete
 *          send the correct payloads, and server validation errors surface to the operator.
 * Caller: Vitest frontend suite for admin archive-routing regressions.
 * Deps: React Testing Library, mocked telegramArchiveService, notification/confirm contexts.
 * SideEffects: Renders jsdom UI with mocked async service responses only.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TelegramArchiveSettings from './TelegramArchiveSettings';

const {
    getOverview, getActivity, createRoute, updateRoute, deleteRoute, verifyChat,
    showNotification, confirmFn,
} = vi.hoisted(() => ({
    getOverview: vi.fn(),
    getActivity: vi.fn(),
    createRoute: vi.fn(),
    updateRoute: vi.fn(),
    deleteRoute: vi.fn(),
    verifyChat: vi.fn(),
    showNotification: vi.fn(),
    confirmFn: vi.fn(),
}));

vi.mock('../services/telegramArchiveService', () => ({
    default: { getOverview, getActivity, createRoute, updateRoute, deleteRoute, verifyChat },
    telegramArchiveService: { getOverview, getActivity, createRoute, updateRoute, deleteRoute, verifyChat },
}));

vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification }),
}));

vi.mock('../contexts/ConfirmContext', () => ({
    useConfirm: () => confirmFn,
}));

const OVERVIEW = {
    available: true,
    routes: [
        {
            id: 'arsip-selatan-ahass',
            enabled: true,
            scope: 'camera',
            cameraId: 1441,
            chatId: '-5510674082',
            label: 'Arsip Selatan AHASS',
        },
    ],
    cameras: [
        {
            id: 1441,
            name: 'CCTV SELATAN AHASS DANDER',
            areaId: 2,
            areaName: 'DS DANDER',
            targets: [{ id: 'arsip-selatan-ahass', chatId: '-5510674082', label: 'Arsip Selatan AHASS', scope: 'camera', mode: 'upload' }],
        },
        { id: 1435, name: 'CCTV LAPANGAN DANDER BARAT', areaId: 2, areaName: 'DS DANDER', targets: [] },
    ],
    areas: [{ id: 2, name: 'DS DANDER' }, { id: 3, name: 'DS TANJUNGHARJO' }],
};

function renderPage() {
    return render(<TelegramArchiveSettings />);
}

async function waitForLoaded() {
    await screen.findByText('Tambah rute baru');
}

beforeEach(() => {
    vi.clearAllMocks();
    getOverview.mockResolvedValue({ success: true, data: structuredClone(OVERVIEW) });
    getActivity.mockResolvedValue({ success: true, data: { available: false, totals: [], recent: [] } });
    createRoute.mockResolvedValue({ success: true, message: 'Rute ditambahkan.' });
    updateRoute.mockResolvedValue({ success: true, message: 'Rute diperbarui.' });
    deleteRoute.mockResolvedValue({ success: true, message: 'Rute dihapus.' });
    confirmFn.mockResolvedValue(true);
});

describe('loading and empty states', () => {
    it('shows a clear message when the sidecar is not installed', async () => {
        getOverview.mockResolvedValue({ success: true, data: { available: false, routes: [], cameras: [], areas: [] } });
        renderPage();
        expect(await screen.findByText(/belum terpasang di server ini/i)).toBeTruthy();
        expect(screen.queryByText('Tambah rute baru')).toBeNull();
    });

    it('summarises how many cameras are actually archived', async () => {
        const { container } = renderPage();
        await waitForLoaded();
        const header = container.querySelector('header');
        expect(within(header).getByText('1/2')).toBeTruthy();
        expect(within(header).getByText(/kamera perekam sedang diarsipkan/i)).toBeTruthy();
    });

    it('marks an unrouted camera as not being sent', async () => {
        renderPage();
        await waitForLoaded();
        // rendered twice on purpose: card list for phones, table for md+ (CSS picks one)
        const rows = screen.getAllByText('CCTV LAPANGAN DANDER BARAT')
            .map((node) => node.closest('li') || node.closest('tr'))
            .filter(Boolean);
        expect(rows).toHaveLength(2);
        rows.forEach((row) => expect(within(row).getByText('tidak dikirim')).toBeTruthy());
    });
});

describe('scope switching', () => {
    it('shows the camera picker for camera scope and swaps to areas for area scope', async () => {
        renderPage();
        await waitForLoaded();

        expect(screen.getByLabelText('Kamera')).toBeTruthy();
        expect(screen.queryByLabelText('Area')).toBeNull();

        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'area' } });
        expect(screen.getByLabelText('Area')).toBeTruthy();
        expect(screen.queryByLabelText('Kamera')).toBeNull();
    });

    it('hides both pickers for "all cameras"', async () => {
        renderPage();
        await waitForLoaded();
        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'all' } });
        expect(screen.queryByLabelText('Kamera')).toBeNull();
        expect(screen.queryByLabelText('Area')).toBeNull();
    });
});

describe('chat id verification', () => {
    it('resolves the group and reports that the bot may post', async () => {
        verifyChat.mockResolvedValue({
            success: true,
            data: { chatId: '-5510674082', title: 'CCTV SELATAN AHASS DANDER', type: 'group', canSendDocuments: true },
        });
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));

        expect(await screen.findByText(/bot bisa mengirim file ke grup ini/i)).toBeTruthy();
        expect(verifyChat).toHaveBeenCalledWith('-5510674082');
    });

    it('warns when the bot cannot send documents there', async () => {
        verifyChat.mockResolvedValue({
            success: true,
            data: { chatId: '-1', title: 'Grup Terkunci', type: 'group', canSendDocuments: false },
        });
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));

        expect(await screen.findByText(/TIDAK diizinkan mengirim file/i)).toBeTruthy();
    });

    it('surfaces a rejected chat id and keeps no verification', async () => {
        verifyChat.mockRejectedValue({ response: { data: { message: 'Telegram menolak: chat not found' } } });
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-9999999999' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));

        await waitFor(() => expect(showNotification)
            .toHaveBeenCalledWith('Telegram menolak: chat not found', 'error'));
        expect(screen.queryByText(/bot bisa mengirim file/i)).toBeNull();
    });

    it('invalidates a passed check as soon as the chat id is edited', async () => {
        verifyChat.mockResolvedValue({
            success: true,
            data: { chatId: '-5510674082', title: 'Grup A', type: 'group', canSendDocuments: true },
        });
        renderPage();
        await waitForLoaded();

        const input = screen.getByLabelText('ID grup Telegram');
        fireEvent.change(input, { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
        expect(await screen.findByText(/Grup A/)).toBeTruthy();

        fireEvent.change(input, { target: { value: '-5510674083' } });
        expect(screen.queryByText(/Grup A/)).toBeNull();
    });

    it('does not call the server with an empty chat id', async () => {
        renderPage();
        await waitForLoaded();
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
        expect(verifyChat).not.toHaveBeenCalled();
        expect(showNotification).toHaveBeenCalledWith('Isi ID grup dulu', 'warning');
    });
});

describe('creating a route', () => {
    it('sends the camera payload and reloads', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-5562560753' } });
        fireEvent.change(screen.getByLabelText('Nama rute'), { target: { value: 'Arsip Lapangan Dander Barat' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalledWith({
            scope: 'camera',
            cameraId: 1435,
            chatId: '-5562560753',
            label: 'Arsip Lapangan Dander Barat',
            enabled: true,
        }));
        expect(getOverview).toHaveBeenCalledTimes(2);   // initial + reload
    });

    it('sends areaId (and no cameraId) for an area route', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'area' } });
        fireEvent.change(screen.getByLabelText('Area'), { target: { value: '3' } });
        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalled());
        const payload = createRoute.mock.calls[0][0];
        expect(payload).toMatchObject({ scope: 'area', areaId: 3 });
        expect(payload.cameraId).toBeUndefined();
    });

    it('trims whitespace out of the chat id before sending', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '  -5562560753  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalled());
        expect(createRoute.mock.calls[0][0].chatId).toBe('-5562560753');
    });

    it('shows the server validation message instead of failing silently', async () => {
        createRoute.mockRejectedValue({ response: { data: { message: 'Rute yang sama persis sudah ada' } } });
        renderPage();
        await waitForLoaded();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1441' } });
        fireEvent.change(screen.getByLabelText('ID grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(showNotification)
            .toHaveBeenCalledWith('Rute yang sama persis sudah ada', 'error'));
    });
});

describe('editing, toggling, deleting', () => {
    it('loads an existing route into the form and updates it', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));
        expect(screen.getByLabelText('Nama rute').value).toBe('Arsip Selatan AHASS');
        expect(screen.getByLabelText('ID grup Telegram').value).toBe('-5510674082');

        fireEvent.change(screen.getByLabelText('Nama rute'), { target: { value: 'Nama Baru' } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));

        await waitFor(() => expect(updateRoute).toHaveBeenCalledWith(
            'arsip-selatan-ahass',
            expect.objectContaining({ label: 'Nama Baru', cameraId: 1441, scope: 'camera' }),
        ));
    });

    it('cancels an edit without saving', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

        expect(screen.getByLabelText('ID grup Telegram').value).toBe('');
        expect(updateRoute).not.toHaveBeenCalled();
    });

    it('toggles a route off without touching any other field', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Nonaktifkan' }));

        await waitFor(() => expect(updateRoute).toHaveBeenCalledWith(
            'arsip-selatan-ahass',
            expect.objectContaining({ enabled: false, chatId: '-5510674082', cameraId: 1441 }),
        ));
    });

    it('asks for confirmation before deleting and honours a cancel', async () => {
        confirmFn.mockResolvedValue(false);
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
        await waitFor(() => expect(confirmFn).toHaveBeenCalled());
        expect(deleteRoute).not.toHaveBeenCalled();
    });

    it('deletes once confirmed', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Hapus' }));
        await waitFor(() => expect(deleteRoute).toHaveBeenCalledWith('arsip-selatan-ahass'));
    });
});

describe('activity panel', () => {
    it('stays hidden when the sidecar has never run', async () => {
        renderPage();
        await waitForLoaded();
        expect(screen.queryByText('Aktivitas pengiriman')).toBeNull();
    });

    it('renders totals and recent uploads when available', async () => {
        getActivity.mockResolvedValue({
            success: true,
            data: {
                available: true,
                totals: [{ status: 'ok', files: 12, bytes: 1610612736 }],
                recent: [{
                    segmentId: 204993, cameraId: 1441, filename: '20260727_061000.mp4',
                    fileSize: 134950912, status: 'ok', targets: [], uploadedAt: '2026-07-27 06:22:40',
                }],
            },
        });
        renderPage();

        expect(await screen.findByText('Aktivitas pengiriman')).toBeTruthy();
        const tile = screen.getByText('1.5 GB').closest('div');
        expect(within(tile).getByText('terkirim')).toBeTruthy();
        expect(within(tile).getByText('12')).toBeTruthy();
        expect(screen.getByText('20260727_061000.mp4')).toBeTruthy();
    });
});
