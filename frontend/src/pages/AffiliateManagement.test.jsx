/*
 * AffiliateManagement.test.jsx — the two admin editors after they moved into ui/Modal.
 *
 * Written WITH that conversion, because the page had no unit coverage before it and the conversion
 * moved two things that fail silently when they break:
 *   1. Simpan now sits in the dialog FOOTER, outside the <form>, joined to it only by
 *      `form="affiliate-offer-form"`. A stale id does not throw — the button just stops saving.
 *   2. Both dialogs are dismissible={false}. That is the OPPOSITE of ui/Modal's default, so
 *      nothing but a test keeps it from being "tidied" back to the default and quietly turning a
 *      mistap into a lost 24-field draft.
 *
 * The real validators/normalisers are kept (only the network calls are stubbed): a fake
 * normalizeTargetIds would let the editor render a shape the page never actually produces.
 *
 * Plain DOM assertions on purpose: this project does not load @testing-library/jest-dom.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AffiliateManagement from './AffiliateManagement';

const h = vi.hoisted(() => ({
    listPartners: vi.fn(),
    listOffers: vi.fn(),
    deletePartner: vi.fn(),
    deleteOffer: vi.fn(),
    createPartner: vi.fn(),
    updatePartner: vi.fn(),
    createOffer: vi.fn(),
    updateOffer: vi.fn(),
    getOfferStats: vi.fn(),
    uploadOfferImage: vi.fn(),
    removeOfferImage: vi.fn(),
    getAllAreas: vi.fn(),
    getAllCameras: vi.fn(),
    showNotification: vi.fn(),
    confirm: vi.fn(),
}));

vi.mock('../services/affiliateAdminService', async (importOriginal) => ({
    ...(await importOriginal()),
    listPartners: h.listPartners,
    listOffers: h.listOffers,
    deletePartner: h.deletePartner,
    deleteOffer: h.deleteOffer,
    createPartner: h.createPartner,
    updatePartner: h.updatePartner,
    createOffer: h.createOffer,
    updateOffer: h.updateOffer,
    getOfferStats: h.getOfferStats,
    uploadOfferImage: h.uploadOfferImage,
    removeOfferImage: h.removeOfferImage,
}));
vi.mock('../services/areaService', () => ({ areaService: { getAllAreas: h.getAllAreas } }));
vi.mock('../services/cameraService', () => ({ cameraService: { getAllCameras: h.getAllCameras } }));
vi.mock('../contexts/NotificationContext', () => ({
    useNotification: () => ({ showNotification: h.showNotification }),
}));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => h.confirm }));

const PARTNER = {
    id: 3,
    store_name: 'Toko Bangun Jaya',
    store_url: 'https://tokoku.example.com',
    billing_mode: 'term',
    price_rupiah: 250000,
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    active: 1,
};

const OFFER = {
    id: 9,
    partner_id: 3,
    product_title: 'Kamera Wi-Fi Indoor 3MP',
    product_url: 'https://tokoku.example.com/produk/kamera-3mp',
    target_mode: 'camera',
    camera_ids: [11],
    area_ids: [],
    placements: ['popup'],
    priority: 100,
    active: 1,
    product_price_rupiah: 385000,
    image_base: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    h.listPartners.mockResolvedValue({ success: true, data: [PARTNER] });
    h.listOffers.mockResolvedValue({ success: true, data: [OFFER] });
    h.getAllAreas.mockResolvedValue({ success: true, data: [{ id: 2, name: 'DANDER' }] });
    h.getAllCameras.mockResolvedValue({ success: true, data: [{ id: 11, name: 'CCTV DANDER' }] });
    h.getOfferStats.mockResolvedValue({ success: true, data: { rows: [], totals: null } });
    h.deletePartner.mockResolvedValue({ success: true });
    h.deleteOffer.mockResolvedValue({ success: true });
    h.confirm.mockResolvedValue(true);
});

/** Opens the mitra editor and returns its dialog. */
async function openPartnerEditor() {
    render(<AffiliateManagement />);
    fireEvent.click(await screen.findByRole('button', { name: 'Tambah mitra' }));
    return screen.getByRole('dialog');
}

/** Switches to the Barang tab and opens the barang editor on the seeded offer. */
async function openOfferEditor() {
    render(<AffiliateManagement />);
    fireEvent.click(await screen.findByRole('tab', { name: /Barang/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
    return screen.getByRole('dialog');
}

describe('the mitra editor is a dialog', () => {
    it('holds the partner form, with its own fields', async () => {
        const dialog = await openPartnerEditor();

        expect(dialog.getAttribute('aria-modal')).toBe('true');
        expect(within(dialog).getByText('Mitra baru')).not.toBeNull();
        expect(within(dialog).getByPlaceholderText('Toko Bangun Jaya')).not.toBeNull();
    });

    it('lets the footer Simpan submit the form it sits outside of', async () => {
        const dialog = await openPartnerEditor();
        const form = dialog.querySelector('form');
        const save = within(dialog).getByRole('button', { name: 'Simpan mitra' });

        expect(form.contains(save)).toBe(false);
        expect(save.form).toBe(form);
    });

    it('cannot be dismissed by Escape or a close button — only Batal', async () => {
        const dialog = await openPartnerEditor();

        expect(screen.queryByRole('button', { name: 'Tutup dialog' })).toBeNull();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog')).not.toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});

describe('the barang editor is a dialog', () => {
    it('holds the offer form with its camera picker, on top of the list', async () => {
        const dialog = await openOfferEditor();

        expect(within(dialog).getByText(/Ubah barang/)).not.toBeNull();
        // The picker is the widest thing in admin and the reason this dialog is size="xl".
        expect(within(dialog).getByLabelText('Cari Kamera')).not.toBeNull();
        // The row behind stays rendered: a dialog covers the list, it does not replace it.
        expect(screen.getAllByText('Kamera Wi-Fi Indoor 3MP').length).toBeGreaterThan(0);
    });

    it('lets the footer Simpan submit the form it sits outside of', async () => {
        const dialog = await openOfferEditor();
        const form = dialog.querySelector('form');
        const save = within(dialog).getByRole('button', { name: 'Simpan barang' });

        expect(form.contains(save)).toBe(false);
        expect(save.form).toBe(form);
    });

    it('cannot be dismissed by Escape or a close button — only Batal', async () => {
        const dialog = await openOfferEditor();

        expect(screen.queryByRole('button', { name: 'Tutup dialog' })).toBeNull();
        fireEvent.keyDown(dialog, { key: 'Escape' });
        expect(screen.getByRole('dialog')).not.toBeNull();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Batal' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('carries the offer through to updateOffer when the footer button is pressed', async () => {
        h.updateOffer.mockResolvedValue({ success: true, data: OFFER });
        const dialog = await openOfferEditor();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        // End to end through the form-attribute association — the part that fails silently.
        await waitFor(() => expect(h.updateOffer).toHaveBeenCalledWith(9, expect.objectContaining({
            product_title: 'Kamera Wi-Fi Indoor 3MP',
            target_mode: 'camera',
        })));
    });
});

describe('deleting goes through the app-wide confirm', () => {
    it('names the cascade before removing a mitra, then removes it', async () => {
        render(<AffiliateManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));

        await waitFor(() => expect(h.confirm).toHaveBeenCalledWith(expect.objectContaining({
            tone: 'danger',
            // The offer count is the only thing on screen saying how much goes with it.
            message: expect.stringContaining('beserta 1 barang'),
        })));
        await waitFor(() => expect(h.deletePartner).toHaveBeenCalledWith(3));
    });

    it('does not delete a mitra when the operator backs out', async () => {
        h.confirm.mockResolvedValue(false);

        render(<AffiliateManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));

        await waitFor(() => expect(h.confirm).toHaveBeenCalled());
        expect(h.deletePartner).not.toHaveBeenCalled();
    });

    it('removes a barang from the Barang tab', async () => {
        render(<AffiliateManagement />);
        fireEvent.click(await screen.findByRole('tab', { name: /Barang/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Hapus' }));

        await waitFor(() => expect(h.deleteOffer).toHaveBeenCalledWith(9));
        expect(h.deletePartner).not.toHaveBeenCalled();
    });
});
