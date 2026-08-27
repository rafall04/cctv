/*
 * Purpose: Kunci dua janji sisi klien arbiter slot — muatan afiliasi disaring sebelum jadi <a href>,
 *          dan satu konteks hanya menghitung satu impresi per hari.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Arbiter memindahkan resolusi afiliasi ke endpoint baru. Rute lama melewatkan tiap muatan melalui
 * sanitizePublicOffer sebelum apa pun menjadi tautan; rute baru sempat TIDAK, dan itu terlewat
 * karena tes komponennya memakai fixture yang memang sudah bersih. Tes di sini memakai fixture yang
 * KOTOR, karena hanya muatan kotor yang bisa membuktikan penyaringnya berdiri.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const get = vi.fn();
vi.mock('./apiClient', () => ({ default: { get: (...a) => get(...a) } }));

const { resolveCommercialSlotOnce, clearCommercialSlotCache } = await import('./commercialSlotService.js');

const BERSIH = {
    id: 12, product_title: 'Kamera IP Outdoor 3MP', store_name: 'Toko Sinar',
    product_url: 'https://toko-sinar.example/produk', product_href: '/api/public/affiliate/offers/12/go?l=p',
    store_url: 'https://toko-sinar.example', store_href: '/api/public/affiliate/offers/12/go?l=s',
    whatsapp_url: 'https://wa.me/628123456789', price_rupiah: 150000,
    image_base: 'offer-12', image_width: 800, image_height: 600,
};
const balas = (data) => get.mockResolvedValue({ data: { success: true, data } });
const KTX = { placement: 'popup', cameraId: 1444 };

beforeEach(() => {
    get.mockReset();
    clearCommercialSlotCache();
});
afterEach(() => { clearCommercialSlotCache(); });

describe('muatan afiliasi disaring di jalur baru juga', () => {
    it('membuang tawaran yang SATU-SATUNYA tautannya javascript:', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, product_url: 'javascript:alert(1)', product_href: null } });

        // Tanpa tautan yang sah, tidak ada kartu - bukan kartu dengan tombol yang tidak bisa diklik.
        expect(await resolveCommercialSlotOnce(KTX)).toBeNull();
    });

    it('menjatuhkan tautan toko yang jahat TANPA menjatuhkan tawarannya', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, store_url: 'javascript:alert(1)' } });

        const hasil = await resolveCommercialSlotOnce(KTX);

        expect(hasil.content.store_url, 'skema jahat lolos ke href').toBeNull();
        expect(hasil.content.product_url, 'tautan produk yang sah ikut terbuang').toBe(BERSIH.product_url);
    });

    it('menolak whatsapp_url yang bukan wa.me', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, whatsapp_url: 'https://wa-me.example/628' } });
        expect((await resolveCommercialSlotOnce(KTX)).content.whatsapp_url).toBeNull();
    });

    it('menyalin HANYA kunci yang diizinkan - regresi sisi server tidak bisa membocorkan tambahan', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, partner_fee_rupiah: 25000, partner_id: 4 } });

        const hasil = await resolveCommercialSlotOnce(KTX);

        expect(Object.keys(hasil.content)).not.toContain('partner_fee_rupiah');
        expect(Object.keys(hasil.content)).not.toContain('partner_id');
        // Dan tidak diparkir di sessionStorage lewat pintu belakang.
        expect(JSON.stringify(sessionStorage)).not.toContain('partner_fee_rupiah');
    });

    it('menyimpan versi yang SUDAH bersih, bukan yang mentah', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, store_url: 'javascript:alert(1)' } });
        await resolveCommercialSlotOnce(KTX);
        get.mockReset();

        // Panggilan kedua dilayani cache; kalau yang tersimpan mentah, ia lolos di sini.
        const kedua = await resolveCommercialSlotOnce(KTX);

        expect(get).not.toHaveBeenCalled();
        expect(kedua.content.store_url).toBeNull();
    });

    it('meneruskan promo apa adanya - ia tidak punya penyaring klien dan tidak pernah punya', async () => {
        const promo = { id: 3, title: 'Pemasangan CCTV Gratis', image_base: 'promo-3', cta_url: 'https://wa.me/628' };
        balas({ kind: 'promo', content: promo });

        expect((await resolveCommercialSlotOnce(KTX))).toEqual({ kind: 'promo', content: promo });
    });
});

describe('satu impresi per konteks per hari', () => {
    it('panggilan kedua untuk konteks yang sama tidak menyentuh jaringan', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce(KTX);
        await resolveCommercialSlotOnce(KTX);

        expect(get).toHaveBeenCalledTimes(1);
    });

    it('kamera lain adalah konteks lain, dan memang impresi lain', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce(KTX);
        await resolveCommercialSlotOnce({ placement: 'popup', cameraId: 1445 });

        expect(get).toHaveBeenCalledTimes(2);
    });

    it('permukaan lain adalah konteks lain - beranda lalu popup itu dua impresi yang sah', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce({ placement: 'landing' });
        await resolveCommercialSlotOnce({ placement: 'popup' });

        expect(get).toHaveBeenCalledTimes(2);
    });

    it('"tidak ada penghuni" TIDAK di-cache - operator yang baru menerbitkan tawaran terlihat', async () => {
        balas(null);
        await resolveCommercialSlotOnce(KTX);
        await resolveCommercialSlotOnce(KTX);

        expect(get).toHaveBeenCalledTimes(2);
    });
});

describe('gagal itu senyap, tidak pernah galat di halaman', () => {
    it('jaringan mati mengembalikan null, bukan melempar', async () => {
        get.mockRejectedValue(new Error('Network Error'));
        await expect(resolveCommercialSlotOnce(KTX)).resolves.toBeNull();
    });

    it('tanpa placement tidak ada permintaan sama sekali', async () => {
        expect(await resolveCommercialSlotOnce({})).toBeNull();
        expect(get).not.toHaveBeenCalled();
    });

    it('meminta endpoint publik dengan konteksnya', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce({ placement: 'area', areaId: 3 });

        expect(get).toHaveBeenCalledWith('/api/public/slot', expect.objectContaining({
            params: expect.objectContaining({ placement: 'area', areaId: 3 }),
        }));
    });
});
