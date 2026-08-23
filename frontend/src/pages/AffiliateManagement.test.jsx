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
 * Extended when the other three surfaces were unlocked, because two of those failures are also
 * silent:
 *   3. The placement boxes were rendered `disabled` with a note saying the surfaces were not wired.
 *      Both are gone; a test that only counted four boxes would still pass against four disabled
 *      ones, so the tests below tick them and follow the value through to updateOffer.
 *   4. "Halaman depan" cannot match a camera-/area-targeted offer AT ALL. The warning that says so
 *      is asserted absent, then present, then absent again after the target changes — a warning
 *      that renders unconditionally would fail that middle-out shape, which is the point.
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

describe('lokasi tampil offers every surface the backend serves', () => {
    const boxFor = (dialog, name) => within(dialog).getByRole('checkbox', { name });

    it('renders all four surfaces, none of them locked, with the saved one ticked', async () => {
        const dialog = await openOfferEditor();

        const boxes = [
            boxFor(dialog, /Bawah video live/),
            boxFor(dialog, /Halaman area/),
            boxFor(dialog, /Halaman depan/),
            boxFor(dialog, /Halaman rekaman/),
        ];
        // `disabled` was the old state of this fieldset; four boxes that cannot be ticked would
        // otherwise satisfy a test that merely counted them.
        expect(boxes.map((box) => box.disabled)).toEqual([false, false, false, false]);
        expect(boxes.map((box) => box.checked)).toEqual([true, false, false, false]);

        // The note claiming the other three were not wired yet is now false and must be gone.
        expect(within(dialog).queryByText(/belum tersambung|pilihannya dikunci/)).toBeNull();
    });

    it('warns that halaman depan can never match a camera-targeted barang, and stops warning when the target opens up', async () => {
        const dialog = await openOfferEditor();
        const warning = () => within(dialog).queryByText(/tidak akan pernah tampil di sana/);

        // Seeded offer targets one camera and is popup-only: nothing to warn about yet.
        expect(warning()).toBeNull();

        fireEvent.click(boxFor(dialog, /Halaman depan/));
        expect(warning()).not.toBeNull();

        // Switching to "Semua kamera" makes the placement legitimate, so the warning must retract.
        fireEvent.click(within(dialog).getByRole('radio', { name: /Semua kamera/ }));
        expect(warning()).toBeNull();
    });

    it('carries the ticked surfaces through to updateOffer', async () => {
        h.updateOffer.mockResolvedValue({ success: true, data: OFFER });
        const dialog = await openOfferEditor();

        fireEvent.click(boxFor(dialog, /Halaman area/));
        fireEvent.click(boxFor(dialog, /Halaman rekaman/));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        await waitFor(() => expect(h.updateOffer).toHaveBeenCalledWith(9, expect.objectContaining({
            placements: ['popup', 'area', 'playback'],
        })));
    });

    it('refuses to save with every surface unticked instead of quietly re-ticking popup', async () => {
        const dialog = await openOfferEditor();

        fireEvent.click(boxFor(dialog, /Bawah video live/));
        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Lokasi tampil kosong',
        })));
        // The old fallback saved ['popup'] here — an offer republished to a surface the operator
        // had just turned off, with a green toast over it.
        expect(h.updateOffer).not.toHaveBeenCalled();
    });
});

describe('the statistik panel splits the counts per surface', () => {
    const STATS = {
        days: 30,
        rows: [
            { stat_date: '2026-08-22', placement: 'popup', impressions: 20, product_clicks: 3, store_clicks: 1, whatsapp_clicks: 0 },
            { stat_date: '2026-08-22', placement: 'area', impressions: 12, product_clicks: 2, store_clicks: 0, whatsapp_clicks: 1 },
            { stat_date: '2026-08-21', placement: 'popup', impressions: 8, product_clicks: 1, store_clicks: 0, whatsapp_clicks: 0 },
            { stat_date: '2026-08-21', placement: 'landing', impressions: 2, product_clicks: 0, store_clicks: 0, whatsapp_clicks: 0 },
        ],
        by_placement: [
            { placement: 'popup', impressions: 28, product_clicks: 4, store_clicks: 1, whatsapp_clicks: 0 },
            { placement: 'area', impressions: 12, product_clicks: 2, store_clicks: 0, whatsapp_clicks: 1 },
            { placement: 'landing', impressions: 2, product_clicks: 0, store_clicks: 0, whatsapp_clicks: 0 },
        ],
        totals: { impressions: 42, product_clicks: 6, store_clicks: 1, whatsapp_clicks: 1 },
    };

    /** Opens the barang tab and expands the counters, returning the panel element. */
    async function openStats() {
        render(<AffiliateManagement />);
        fireEvent.click(await screen.findByRole('tab', { name: /Barang/ }));
        fireEvent.click(await screen.findByRole('button', { name: 'Statistik' }));
        return waitFor(() => {
            const panel = document.getElementById('offer-stats-9');
            if (!panel) throw new Error('stats panel has not loaded');
            return panel;
        });
    }

    it('keeps the total AND lists each surface that actually earned something', async () => {
        h.getOfferStats.mockResolvedValue({ success: true, data: STATS });
        const panel = await openStats();

        // The total answers "is this working at all" and must survive the breakdown landing next to it.
        expect(within(panel).getByText('42')).not.toBeNull();

        const rowFor = (label) => within(panel).getByText(label).closest('div');
        expect(rowFor('Bawah video live').textContent).toContain('28 tayang');
        expect(rowFor('Bawah video live').textContent).toContain('4 klik barang');
        expect(rowFor('Halaman area').textContent).toContain('12 tayang');
        expect(rowFor('Halaman area').textContent).toContain('1 klik WA');
        expect(rowFor('Halaman depan').textContent).toContain('2 tayang');

        // Playback earned nothing, so it has no row: reporting a fabricated "0 tayang" would read
        // like a surface that failed rather than one that was never published to.
        expect(within(panel).queryByText('Halaman rekaman')).toBeNull();
    });

    it('counts DAYS with data, not stat rows — one day is now up to four rows', async () => {
        h.getOfferStats.mockResolvedValue({ success: true, data: STATS });
        const panel = await openStats();

        // Four rows across two dates. rows.length would say "4 hari", which grows when nothing but
        // the placement list did.
        expect(panel.textContent).toContain('2 hari ada datanya');
        expect(panel.textContent).not.toContain('4 hari ada datanya');
    });

    it('keeps the "indikatif, bukan tagihan" note and drops the breakdown when nothing has been counted', async () => {
        const panel = await openStats();

        expect(panel.textContent).toContain('bukan tagihan');
        expect(panel.textContent).toContain('belum ada data');
        expect(within(panel).queryByText(/Per lokasi tampil/)).toBeNull();
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

/*
 * REGRESI, dilaporkan operator 2026-08-23: "pilih rekaman, klik simpan barang, tidak ada respon."
 *
 * Simpanannya BERHASIL setiap kali — barang id 3 di produksi memang berubah. Yang tidak ada
 * umpan baliknya, dan itu dua cacat yang kebetulan saling menutupi:
 *
 *   1. Toast sukses dirender DI BELAKANG dialog (z mentah, dijaga di components/ui/adoption.test.jsx).
 *   2. Dialognya tidak pernah menutup, jadi layarnya tampak persis sama sebelum dan sesudah.
 *
 * Salah satu saja masih menyisakan tanda: toast tanpa penutupan masih terlihat, penutupan tanpa
 * toast masih terasa. Berdua, tombolnya jadi tidak bisa dibedakan dari tombol mati. Karena itu
 * penutupan diuji di sini SEBAGAI PERILAKU, bukan lewat pemindaian: hanya render sungguhan yang
 * membuktikan onDone benar-benar sampai melewati form.
 */
describe('menyimpan barang memberi tanda bahwa sesuatu terjadi', () => {
    it('menutup dialog setelah simpanan berhasil', async () => {
        h.updateOffer.mockResolvedValue({ success: true, data: OFFER });
        const dialog = await openOfferEditor();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('memunculkan notifikasi sukses, bukan diam', async () => {
        h.updateOffer.mockResolvedValue({ success: true, data: OFFER });
        const dialog = await openOfferEditor();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'success' }),
        ));
    });

    /*
     * Sisi lain yang sama pentingnya: kegagalan TIDAK boleh menutup. Menutup dialog pada
     * penolakan akan membuang ketikan operator dan menyisakan pesan galat yang menunjuk formulir
     * yang sudah tidak ada.
     */
    it('mempertahankan dialog beserta isiannya ketika halaman menolak', async () => {
        h.updateOffer.mockResolvedValue({ success: false, message: 'URL toko tidak sah' });
        const dialog = await openOfferEditor();

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan barang' }));

        await waitFor(() => expect(h.showNotification).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'error' }),
        ));
        expect(screen.queryByRole('dialog')).not.toBeNull();
    });

    /* Mitra sudah menutup sejak awal — dikunci supaya kedua editor tidak berpisah perilaku lagi. */
    it('menutup dialog mitra dengan cara yang sama', async () => {
        h.updatePartner.mockResolvedValue({ success: true, data: PARTNER });
        render(<AffiliateManagement />);
        fireEvent.click(await screen.findByRole('button', { name: 'Ubah' }));
        const dialog = screen.getByRole('dialog');

        fireEvent.click(within(dialog).getByRole('button', { name: 'Simpan mitra' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });
});
