// @vitest-environment jsdom

/*
 * Purpose: Prove the admin catalogue page does what the SQL edit used to — show every package
 *          including disabled ones, flip one on/off, edit its commercials, and add a new one.
 * Caller: Vitest frontend suite.
 * Deps: React Testing Library, mocked playbackProductService + NotificationContext.
 * SideEffects: jsdom render only.
 *
 * The disabled-package cases matter most: a page that only listed what is currently sold could
 * never switch anything back on, which is the exact dead end this page exists to remove.
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PlaybackProductManagement from './PlaybackProductManagement';
import playbackProductService from '../services/playbackProductService';

vi.mock('../services/playbackProductService', () => ({
    default: { listProducts: vi.fn(), createProduct: vi.fn(), updateProduct: vi.fn() },
}));

const notify = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() };
vi.mock('../contexts/NotificationContext', () => ({ useNotification: () => notify }));

const TRIAL = {
    id: 1, key: 'trial', label: 'Coba Gratis', description: 'Satu jam.',
    price_rupiah: 0, window_hours: 1, validity_days: 3, is_trial: 1, enabled: 1, sort_order: 0,
};
const MONTHLY = {
    id: 4, key: 'monthly', label: 'Bulanan', description: '30 hari ke belakang.',
    price_rupiah: 75000, window_hours: 720, validity_days: 30, is_trial: 0, enabled: 0, sort_order: 3,
};

const cardFor = (name) => screen.getByText(name).closest('div.rounded-card');

beforeEach(() => {
    vi.clearAllMocks();
    playbackProductService.listProducts.mockResolvedValue({ success: true, data: [TRIAL, MONTHLY] });
});

describe('PlaybackProductManagement listing', () => {
    it('shows DISABLED packages too, so they can be switched back on', async () => {
        render(<PlaybackProductManagement />);

        expect(await screen.findByText('Bulanan')).toBeTruthy();
        expect(within(cardFor('Bulanan')).getByText('Tidak dijual')).toBeTruthy();
        expect(within(cardFor('Coba Gratis')).getByText('Dijual')).toBeTruthy();
    });

    /*
     * Asserted by LABEL, not by value. On the monthly package 720 hours of depth and 30 days of
     * validity both render "30 hari", so matching on the text alone would pass even if the page
     * printed one number twice — which is precisely the mix-up the header note warns about.
     */
    it('states the price and both time axes without conflating them', async () => {
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');
        const fact = (label) => within(cardFor('Bulanan')).getByText(label).nextElementSibling.textContent;

        expect(fact('Harga')).toBe('Rp 75.000');
        expect(fact('Lihat ke belakang')).toBe('30 hari');
        expect(fact('Masa berlaku')).toBe('30 hari');
        expect(fact('Urutan')).toBe('3');
    });

    it('surfaces a load failure instead of showing an empty catalogue', async () => {
        playbackProductService.listProducts.mockResolvedValue({ success: false, message: 'Sesi habis' });
        render(<PlaybackProductManagement />);

        expect(await screen.findByText('Sesi habis')).toBeTruthy();
    });

    /* Selling nothing is a valid configuration, so it is stated — not flagged as a fault. */
    it('says plainly when nothing at all is on sale', async () => {
        playbackProductService.listProducts.mockResolvedValue({
            success: true, data: [{ ...TRIAL, enabled: 0 }, MONTHLY],
        });
        render(<PlaybackProductManagement />);

        expect(await screen.findByText('Tidak ada paket yang dijual')).toBeTruthy();
    });
});

describe('PlaybackProductManagement switching a package on', () => {
    it('sends the flipped enabled flag and reflects the result', async () => {
        playbackProductService.updateProduct.mockResolvedValue({
            success: true, data: { ...MONTHLY, enabled: 1 },
        });
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(within(cardFor('Bulanan')).getByRole('button', { name: 'Aktifkan' }));

        await waitFor(() => expect(playbackProductService.updateProduct).toHaveBeenCalledWith(4, { enabled: 1 }));
        expect(await within(cardFor('Bulanan')).findByText('Dijual')).toBeTruthy();
    });

    it('keeps the old state and reports why when the save fails', async () => {
        playbackProductService.updateProduct.mockResolvedValue({ success: false, message: 'Ditolak server' });
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(within(cardFor('Bulanan')).getByRole('button', { name: 'Aktifkan' }));

        await waitFor(() => expect(notify.error).toHaveBeenCalledWith('Gagal menyimpan', 'Ditolak server'));
        expect(within(cardFor('Bulanan')).getByText('Tidak dijual')).toBeTruthy();
    });
});

describe('PlaybackProductManagement editing', () => {
    it('saves changed commercials as INTEGER rupiah, not text', async () => {
        playbackProductService.updateProduct.mockResolvedValue({
            success: true, data: { ...MONTHLY, price_rupiah: 60000 },
        });
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(within(cardFor('Bulanan')).getByRole('button', { name: 'Ubah' }));
        const card = within(cardFor('Bulanan'));
        fireEvent.change(card.getByLabelText('Harga (rupiah)'), { target: { value: '60000' } });
        fireEvent.click(card.getByRole('button', { name: 'Simpan' }));

        await waitFor(() => {
            expect(playbackProductService.updateProduct).toHaveBeenCalledWith(4, expect.objectContaining({
                price_rupiah: 60000,
                window_hours: 720,
                validity_days: 30,
            }));
        });
    });

    /*
     * The trial flow never charges, so a price box on it would collect a number the system ignores.
     * The backend rejects it too; disabling the control means the operator never gets that far.
     */
    it('will not let the free trial be given a price', async () => {
        render(<PlaybackProductManagement />);
        await screen.findByText('Coba Gratis');

        fireEvent.click(within(cardFor('Coba Gratis')).getByRole('button', { name: 'Ubah' }));

        expect(within(cardFor('Coba Gratis')).getByLabelText('Harga (rupiah)').disabled).toBe(true);
    });

    it('abandons the draft on Batal instead of keeping it around', async () => {
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(within(cardFor('Bulanan')).getByRole('button', { name: 'Ubah' }));
        fireEvent.change(within(cardFor('Bulanan')).getByLabelText('Nama paket'), { target: { value: 'Diubah' } });
        fireEvent.click(within(cardFor('Bulanan')).getByRole('button', { name: 'Batal' }));

        expect(screen.getByText('Bulanan')).toBeTruthy();
        expect(playbackProductService.updateProduct).not.toHaveBeenCalled();
    });
});

describe('PlaybackProductManagement adding a package', () => {
    it('creates a paid package and puts it in the list', async () => {
        playbackProductService.createProduct.mockResolvedValue({
            success: true,
            data: { id: 9, key: 'dua_minggu', label: 'Dua Minggu', price_rupiah: 40000,
                window_hours: 336, validity_days: 14, is_trial: 0, enabled: 1, sort_order: 99 },
        });
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(screen.getByRole('button', { name: 'Tambah paket' }));
        fireEvent.change(screen.getByLabelText('Kode paket'), { target: { value: 'dua_minggu' } });
        fireEvent.change(screen.getByLabelText('Nama paket'), { target: { value: 'Dua Minggu' } });
        fireEvent.change(screen.getByLabelText('Harga (rupiah)'), { target: { value: '40000' } });
        fireEvent.change(screen.getByLabelText('Lihat ke belakang (jam)'), { target: { value: '336' } });
        fireEvent.change(screen.getByLabelText('Masa berlaku (hari)'), { target: { value: '14' } });
        fireEvent.click(screen.getByRole('button', { name: 'Buat paket' }));

        await waitFor(() => {
            expect(playbackProductService.createProduct).toHaveBeenCalledWith(expect.objectContaining({
                key: 'dua_minggu', label: 'Dua Minggu', price_rupiah: 40000,
                window_hours: 336, validity_days: 14, sort_order: 99,
            }));
        });
        expect(await screen.findByText('Dua Minggu')).toBeTruthy();
    });

    it('keeps the dialog open and explains when the backend refuses', async () => {
        playbackProductService.createProduct.mockResolvedValue({
            success: false, message: 'Kode paket "monthly" sudah dipakai',
        });
        render(<PlaybackProductManagement />);
        await screen.findByText('Bulanan');

        fireEvent.click(screen.getByRole('button', { name: 'Tambah paket' }));
        // Every required field is filled: an incomplete form is blocked by the browser before the
        // request is made, which would test constraint validation rather than the failure path.
        fireEvent.change(screen.getByLabelText('Kode paket'), { target: { value: 'monthly' } });
        fireEvent.change(screen.getByLabelText('Nama paket'), { target: { value: 'Bentrok' } });
        fireEvent.change(screen.getByLabelText('Harga (rupiah)'), { target: { value: '1000' } });
        fireEvent.change(screen.getByLabelText('Lihat ke belakang (jam)'), { target: { value: '24' } });
        fireEvent.change(screen.getByLabelText('Masa berlaku (hari)'), { target: { value: '1' } });
        fireEvent.click(screen.getByRole('button', { name: 'Buat paket' }));

        await waitFor(() => {
            expect(notify.error).toHaveBeenCalledWith('Gagal membuat paket', 'Kode paket "monthly" sudah dipakai');
        });
        expect(screen.getByRole('button', { name: 'Buat paket' })).toBeTruthy();
    });
});
