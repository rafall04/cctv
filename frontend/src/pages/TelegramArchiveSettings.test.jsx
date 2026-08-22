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
    groups: [
        { chatId: '-5510674082', title: 'CCTV SELATAN AHASS DANDER', type: 'group', status: 'member', canSend: true },
        { chatId: '-5562560753', title: 'CCTV LAPANGAN DANDER BARAT', type: 'group', status: 'member', canSend: true },
        { chatId: '-5599990000', title: 'GRUP TERKUNCI', type: 'group', status: 'member', canSend: false },
    ],
};

function renderPage() {
    return render(<TelegramArchiveSettings />);
}

/*
 * The route form is a ui/Modal now, so "the page has loaded" can no longer be "the form is on
 * screen" — it is the button that opens it. Note the trigger reads "+ Tambah rute" while the submit
 * button inside the dialog reads "Tambah rute": exact-name role queries keep the two apart.
 */
async function waitForLoaded() {
    await screen.findByRole('button', { name: '+ Tambah rute' });
}

/** Loaded page → open add-route dialog. Every field-level test starts here. */
async function openAddForm() {
    await waitForLoaded();
    fireEvent.click(screen.getByRole('button', { name: '+ Tambah rute' }));
    return screen.findByRole('dialog');
}

/** The picker is the default path; these switch to the plain id field. */
const goManual = () => fireEvent.click(screen.getByRole('button', { name: 'Ketik ID manual' }));

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
        // ...and no way to summon it either: the dialog trigger is gone with the rest of the page.
        expect(screen.queryByRole('button', { name: '+ Tambah rute' })).toBeNull();
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
        await openAddForm();

        expect(screen.getByLabelText('Kamera')).toBeTruthy();
        expect(screen.queryByLabelText('Area')).toBeNull();

        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'area' } });
        expect(screen.getByLabelText('Area')).toBeTruthy();
        expect(screen.queryByLabelText('Kamera')).toBeNull();
    });

    it('hides both pickers for "all cameras"', async () => {
        renderPage();
        await openAddForm();
        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'all' } });
        expect(screen.queryByLabelText('Kamera')).toBeNull();
        expect(screen.queryByLabelText('Area')).toBeNull();
    });
});

describe('group picker (discovered groups)', () => {
    it('offers every discovered group instead of asking for an id', async () => {
        renderPage();
        await openAddForm();

        const picker = screen.getByLabelText('Grup Telegram');
        expect(picker.tagName).toBe('SELECT');
        expect([...picker.options].map((o) => o.value)).toEqual(
            ['', '-5510674082', '-5562560753', '-5599990000'],
        );
    });

    it('flags a group the bot may not post files to, right in the option', async () => {
        renderPage();
        await openAddForm();
        const locked = [...screen.getByLabelText('Grup Telegram').options]
            .find((o) => o.value === '-5599990000');
        expect(locked.textContent).toMatch(/bot tak boleh kirim file/i);
    });

    it('picking a group fills the route name and confirms permission without a server call', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5562560753' } });

        expect(screen.getByLabelText('Nama rute').value).toBe('CCTV LAPANGAN DANDER BARAT');
        expect(await screen.findByText(/bot bisa mengirim file ke grup ini/i)).toBeTruthy();
        expect(verifyChat).not.toHaveBeenCalled();
    });

    it('does not overwrite a route name the operator already typed', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Nama rute'), { target: { value: 'Punya Saya' } });
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5562560753' } });

        expect(screen.getByLabelText('Nama rute').value).toBe('Punya Saya');
    });

    it('saves the picked group id', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5562560753' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalledWith(expect.objectContaining({
            cameraId: 1435, chatId: '-5562560753',
        })));
    });

    it('falls back to a plain id field when no group has been discovered yet', async () => {
        getOverview.mockResolvedValue({
            success: true,
            data: { ...structuredClone(OVERVIEW), groups: [] },
        });
        renderPage();
        await openAddForm();

        expect(screen.getByLabelText('Grup Telegram').tagName).toBe('INPUT');
        expect(screen.getByText(/Belum ada grup terdeteksi/i)).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Ketik ID manual' })).toBeNull();
    });
});

describe('chat id verification (manual fallback)', () => {
    it('resolves the group and reports that the bot may post', async () => {
        verifyChat.mockResolvedValue({
            success: true,
            data: { chatId: '-5510674082', title: 'CCTV SELATAN AHASS DANDER', type: 'group', canSendDocuments: true },
        });
        renderPage();
        await openAddForm();

        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5510674082' } });
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
        await openAddForm();

        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));

        expect(await screen.findByText(/TIDAK diizinkan mengirim file/i)).toBeTruthy();
    });

    it('surfaces a rejected chat id and keeps no verification', async () => {
        verifyChat.mockRejectedValue({ response: { data: { message: 'Telegram menolak: chat not found' } } });
        renderPage();
        await openAddForm();

        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-9999999999' } });
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
        await openAddForm();

        goManual();
        const input = screen.getByLabelText('Grup Telegram');
        fireEvent.change(input, { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
        expect(await screen.findByText(/Grup A/)).toBeTruthy();

        fireEvent.change(input, { target: { value: '-5510674083' } });
        expect(screen.queryByText(/Grup A/)).toBeNull();
    });

    it('does not call the server with an empty chat id', async () => {
        renderPage();
        await openAddForm();
        goManual();
        fireEvent.click(screen.getByRole('button', { name: 'Periksa' }));
        expect(verifyChat).not.toHaveBeenCalled();
        expect(showNotification).toHaveBeenCalledWith('Isi ID grup dulu', 'warning');
    });
});

describe('creating a route', () => {
    it('sends the camera payload and reloads', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5562560753' } });
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
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Cakupan'), { target: { value: 'area' } });
        fireEvent.change(screen.getByLabelText('Area'), { target: { value: '3' } });
        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5510674082' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalled());
        const payload = createRoute.mock.calls[0][0];
        expect(payload).toMatchObject({ scope: 'area', areaId: 3 });
        expect(payload.cameraId).toBeUndefined();
    });

    it('trims whitespace out of the chat id before sending', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '  -5562560753  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalled());
        expect(createRoute.mock.calls[0][0].chatId).toBe('-5562560753');
    });

    it('shows the server validation message instead of failing silently', async () => {
        createRoute.mockRejectedValue({ response: { data: { message: 'Rute yang sama persis sudah ada' } } });
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1441' } });
        goManual();
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5510674082' } });
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
        expect(screen.getByLabelText('Grup Telegram').value).toBe('-5510674082');

        fireEvent.change(screen.getByLabelText('Nama rute'), { target: { value: 'Nama Baru' } });
        fireEvent.click(screen.getByRole('button', { name: 'Simpan perubahan' }));

        await waitFor(() => expect(updateRoute).toHaveBeenCalledWith(
            'arsip-selatan-ahass',
            expect.objectContaining({ label: 'Nama Baru', cameraId: 1441, scope: 'camera' }),
        ));
    });

    it('keeps the picker when the route points at a known group', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));
        const control = screen.getByLabelText('Grup Telegram');
        expect(control.tagName).toBe('SELECT');
        expect(control.value).toBe('-5510674082');
    });

    it('falls back to the id field when the route points at a group the bot has left', async () => {
        const data = structuredClone(OVERVIEW);
        data.routes[0].chatId = '-5544332211';       // no longer among the discovered groups
        getOverview.mockResolvedValue({ success: true, data });
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));
        const control = screen.getByLabelText('Grup Telegram');
        expect(control.tagName).toBe('INPUT');
        expect(control.value).toBe('-5544332211');   // never silently reset
    });

    /*
     * Batal now also CLOSES the dialog, so the old "the field went back to empty" assertion has no
     * field left to read. Same guarantee, stated against the new structure: nothing was saved, the
     * dialog is gone, and the draft it was holding did not survive into the next one.
     */
    it('cancels an edit without saving, and does not keep the abandoned draft', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));
        expect(await screen.findByRole('dialog')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Batal' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        expect(updateRoute).not.toHaveBeenCalled();

        await openAddForm();
        expect(screen.getByLabelText('Grup Telegram').value).toBe('');
        expect(screen.getByLabelText('Nama rute').value).toBe('');
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

/*
 * Structure, not behaviour — and worth asserting because both facts are load-bearing elsewhere:
 * the e2e overflow guard only measures this form while it is a [role="dialog"], and "add" and
 * "edit" being ONE dialog is what keeps the two paths from drifting apart.
 */
describe('the form is one dialog, for both adding and editing', () => {
    it('renders the fields inside the dialog, not on the page', async () => {
        renderPage();
        const dialog = await openAddForm();

        expect(within(dialog).getByLabelText('Cakupan')).toBeTruthy();
        expect(within(dialog).getByLabelText('Grup Telegram')).toBeTruthy();
        expect(within(dialog).getByRole('button', { name: 'Tambah rute' })).toBeTruthy();
    });

    it('re-uses the same dialog for an edit, only relabelled', async () => {
        renderPage();
        await waitForLoaded();

        fireEvent.click(screen.getByRole('button', { name: 'Ubah' }));

        const dialogs = await screen.findAllByRole('dialog');
        expect(dialogs).toHaveLength(1);
        expect(within(dialogs[0]).getByText('Ubah rute')).toBeTruthy();
        expect(within(dialogs[0]).getByRole('button', { name: 'Simpan perubahan' })).toBeTruthy();
        expect(screen.queryByText('Tambah rute baru')).toBeNull();
    });

    it('closes itself once the route is saved', async () => {
        renderPage();
        await openAddForm();

        fireEvent.change(screen.getByLabelText('Kamera'), { target: { value: '1435' } });
        fireEvent.change(screen.getByLabelText('Grup Telegram'), { target: { value: '-5562560753' } });
        fireEvent.click(screen.getByRole('button', { name: 'Tambah rute' }));

        await waitFor(() => expect(createRoute).toHaveBeenCalled());
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
