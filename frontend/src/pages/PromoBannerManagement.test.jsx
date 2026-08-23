/*
 * PromoBannerManagement.test.jsx — the admin list page.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import PromoBannerManagement from './PromoBannerManagement';

const h = vi.hoisted(() => ({
    getAllPromoBanners: vi.fn(),
    createPromoBanner: vi.fn(),
    updatePromoBanner: vi.fn(),
    deletePromoBanner: vi.fn(),
    getAllAreas: vi.fn(),
    getAllCameras: vi.fn(),
    showNotification: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('../services/promoBannerService', () => ({
    getAllPromoBanners: h.getAllPromoBanners,
    createPromoBanner: h.createPromoBanner,
    updatePromoBanner: h.updatePromoBanner,
    deletePromoBanner: h.deletePromoBanner,
}));
vi.mock('../services/areaService', () => ({ areaService: { getAllAreas: h.getAllAreas } }));
vi.mock('../services/cameraService', () => ({ cameraService: { getAllCameras: h.getAllCameras } }));
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification: h.showNotification }),
}));
// The page reads the app-wide ConfirmProvider now instead of mounting its own ConfirmDialog, so
// the hook has to exist here or every render throws before it can assert anything.
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => h.confirm }));

const PROMO = {
    id: 7,
    title: 'Pemasangan Gratis',
    placements: ['popup'],
    target_mode: 'all',
    active: 1,
    image_base: 'promo-0123456789ab',
    area_ids: [],
    camera_ids: [],
    total_impressions: 200,
    total_clicks: 10,
    is_live: 1,
    schedule_state: 'live',
};

beforeEach(() => {
    vi.clearAllMocks();
    h.getAllPromoBanners.mockResolvedValue({ success: true, data: [PROMO] });
    h.getAllAreas.mockResolvedValue({ success: true, data: [{ id: 2, name: 'DANDER' }] });
    h.getAllCameras.mockResolvedValue({ success: true, data: [{ id: 11, name: 'CCTV DANDER' }] });
    h.confirm.mockResolvedValue(true);
    h.deletePromoBanner.mockResolvedValue({ success: true });
});

describe('loading is resilient', () => {
    it('still lists promos when the camera request THROWS', async () => {
        /*
         * cameraService.getAllCameras rejects instead of returning { success: false }.
         * A bare Promise.all would reject, so `setLoading(false)` never ran and the
         * whole page — including the promo list, which needs no cameras — stayed
         * stuck on "Memuat…".
         */
        h.getAllCameras.mockRejectedValue(new Error('boom'));

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Pemasangan Gratis')).not.toBeNull();
        await waitFor(() => expect(screen.queryByText('Memuat…')).toBeNull());
    });

    it('still lists promos when the area request throws', async () => {
        h.getAllAreas.mockRejectedValue(new Error('boom'));

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Pemasangan Gratis')).not.toBeNull();
    });

    it('reports a failure to load the promos themselves', async () => {
        h.getAllPromoBanners.mockResolvedValue({ success: false, message: 'gagal' });

        render(<PromoBannerManagement />);

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error', title: expect.stringMatching(/Gagal memuat/) })
        ));
    });

    it('shows an empty state when there are no promos', async () => {
        h.getAllPromoBanners.mockResolvedValue({ success: true, data: [] });

        render(<PromoBannerManagement />);

        expect(await screen.findByText('Belum ada promo.')).not.toBeNull();
    });
});

describe('status chip follows the SERVER schedule state', () => {
    it('shows Tayang for a live banner', async () => {
        render(<PromoBannerManagement />);
        expect(await screen.findByText('Tayang')).not.toBeNull();
    });

    it.each([
        ['expired', 'Kedaluwarsa'],
        ['not_started', 'Belum mulai'],
        ['inactive', 'Nonaktif'],
        ['no_image', 'Tanpa gambar'],
    ])('shows %s as "%s" without recomputing the date in the browser', async (state, label) => {
        // Recomputing "today" from the browser clock (UTC) disagreed with the
        // backend's local-date window for the first 7 hours of every WIB day.
        h.getAllPromoBanners.mockResolvedValue({
            success: true,
            data: [{ ...PROMO, is_live: 0, schedule_state: state }],
        });

        render(<PromoBannerManagement />);

        expect(await screen.findByText(label)).not.toBeNull();
        expect(screen.queryByText('Tayang')).toBeNull();
    });
});

/*
 * The editor moved from an inline <section> into ui/Modal. These assertions replace the ones that
 * used to be implicit in "the form is just there on the page": the form must still be reachable,
 * its Simpan button must still own it now that the button sits OUTSIDE the <form> in the dialog
 * footer, and the dialog must NOT be dismissible — this is a ~24-field draft with no recovery.
 */
describe('the editor is a non-dismissible dialog', () => {
    const openEditor = async () => {
        render(<PromoBannerManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Tambah promo' }));
        return screen.getByRole('dialog');
    };

    it('opens as a dialog holding the form, not as an inline section', async () => {
        const dialog = await openEditor();

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(within(dialog).getByText('Promo baru')).not.toBeNull();
        expect(within(dialog).getByLabelText('Pilih gambar poster')).not.toBeNull();
    });

    it('lets the footer Simpan submit the form it sits outside of', async () => {
        const dialog = await openEditor();
        const form = dialog.querySelector('form');
        const save = within(dialog).getByRole('button', { name: 'Simpan' });

        // The button is in the pinned footer, the form is in the scrollable body: the only thing
        // connecting them is form="promo-banner-form", and a stale id fails silently.
        expect(form.contains(save)).toBe(false);
        expect(save.form).toBe(form);
    });

    it('offers no way to dismiss it except Batal', async () => {
        const dialog = await openEditor();

        // dismissible={false}: ui/Modal hides its own close button and ignores Escape.
        expect(screen.queryByRole('button', { name: 'Tutup dialog' })).toBeNull();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog')).not.toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('keeps the list visible behind it, instead of pushing the rows off screen', async () => {
        await openEditor();
        // The old inline editor rendered ABOVE the list and shoved it down; a dialog does not.
        expect(screen.getByText('Pemasangan Gratis')).not.toBeNull();
    });
});

describe('deleting goes through the app-wide confirm', () => {
    it('deletes only after the operator says yes', async () => {
        render(<PromoBannerManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));

        await waitFor(() => expect(h.confirm).toHaveBeenCalledWith(
            expect.objectContaining({ tone: 'danger', message: expect.stringContaining('Pemasangan Gratis') })
        ));
        await waitFor(() => expect(h.deletePromoBanner).toHaveBeenCalledWith(7));
    });

    it('does not delete when the operator backs out', async () => {
        h.confirm.mockResolvedValue(false);

        render(<PromoBannerManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));

        await waitFor(() => expect(h.confirm).toHaveBeenCalled());
        expect(h.deletePromoBanner).not.toHaveBeenCalled();
    });
});

describe('stats readout', () => {
    it('shows impressions, clicks, and the rate between them', async () => {
        render(<PromoBannerManagement />);
        expect(await screen.findByText(/200 tayang · 10 klik/)).not.toBeNull();
        expect(screen.getByText(/5\.0%/)).not.toBeNull();
    });

    it('does not divide by zero before the first impression', async () => {
        h.getAllPromoBanners.mockResolvedValue({
            success: true,
            data: [{ ...PROMO, total_impressions: 0, total_clicks: 0 }],
        });

        render(<PromoBannerManagement />);

        expect(await screen.findByText(/0 tayang · 0 klik/)).not.toBeNull();
        expect(screen.queryByText(/NaN/)).toBeNull();
    });
});

/*
 * REGRESI SAUDARA. Cacat "tidak ada respon" dilaporkan di halaman Toko Rekanan, tapi form barang
 * di sana adalah SALINAN dari PromoBannerForm — termasuk salinan bagian yang menahan dialog tetap
 * terbuka sesudah simpan. Jadi halaman ini menyandang cacat yang sama, hanya belum dilaporkan.
 *
 * Menguji keduanya sengaja: dua form yang berbagi asal usul berhak berbagi jaring pengaman, kalau
 * tidak perbaikan di satu tempat akan lepas lagi lewat tempat satunya.
 */
describe('menyimpan promo memberi tanda bahwa sesuatu terjadi', () => {
    const openExisting = async () => {
        render(<PromoBannerManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
        return screen.getByRole('dialog');
    };

    it('menutup dialog setelah simpanan berhasil', async () => {
        h.updatePromoBanner.mockResolvedValue({ success: true, data: PROMO });
        const dialog = await openExisting();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('mempertahankan dialog beserta isiannya ketika halaman menolak', async () => {
        h.updatePromoBanner.mockResolvedValue({ success: false, message: 'judul kosong' });
        const dialog = await openExisting();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan' }));

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' }),
        ));
        expect(screen.queryByRole('dialog')).not.toBeNull();
    });
});
