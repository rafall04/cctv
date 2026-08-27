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

    it('menyaring lagi pada tiap pengambilan, bukan sekali lalu dipercaya', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, store_url: 'javascript:alert(1)' } });

        await resolveCommercialSlotOnce(KTX);
        const kedua = await resolveCommercialSlotOnce(KTX);

        expect(kedua.content.store_url).toBeNull();
    });

    it('meneruskan promo apa adanya - ia tidak punya penyaring klien dan tidak pernah punya', async () => {
        const promo = { id: 3, title: 'Pemasangan CCTV Gratis', image_base: 'promo-3', cta_url: 'https://wa.me/628' };
        balas({ kind: 'promo', content: promo });

        expect((await resolveCommercialSlotOnce(KTX))).toEqual({ kind: 'promo', content: promo });
    });
});

/*
 * INI BLOK YANG BERUBAH ARTINYA, DAN KENAPA.
 *
 * Versi pertama menyinggahkan MUATANNYA seharian. Hitungannya benar, tapi operator yang menyunting
 * judul tawaran di panel admin tidak pernah melihat hasilnya di halaman publik sampai tabnya
 * ditutup - terjadi sungguhan pada 'CCTV Imou PS3D 3MP', 2026-08-27. Bentuk kegagalan yang jahat:
 * satu-satunya cara memeriksa suntingan Anda berhasil adalah melihat halaman publik, dan justru
 * itu yang berbohong.
 *
 * Sekarang isinya SELALU diambil segar; yang dijaga sekali per hari adalah IMPRESINYA.
 */
describe('isinya selalu segar, impresinya tetap sekali per hari', () => {
    it('SUNTINGAN OPERATOR LANGSUNG TERLIHAT pada pemasangan berikutnya', async () => {
        balas({ kind: 'affiliate', content: { ...BERSIH, product_title: 'CCTV Imou PS3D' } });
        const sebelum = await resolveCommercialSlotOnce(KTX);

        // Operator menambahkan '3MP' di panel admin.
        balas({ kind: 'affiliate', content: { ...BERSIH, product_title: 'CCTV Imou PS3D 3MP' } });
        const sesudah = await resolveCommercialSlotOnce(KTX);

        expect(sebelum.content.product_title).toBe('CCTV Imou PS3D');
        expect(sesudah.content.product_title, 'halaman publik masih menyajikan judul lama').toBe('CCTV Imou PS3D 3MP');
    });

    it('permintaan PERTAMA tidak membawa penanda - ia yang dihitung', async () => {
        balas({ kind: 'affiliate', content: BERSIH });

        await resolveCommercialSlotOnce(KTX);

        expect(get.mock.calls[0][1].params.counted).toBeUndefined();
    });

    it('permintaan BERIKUTNYA membawa counted=1 supaya server tidak menghitung dua kali', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce(KTX);

        await resolveCommercialSlotOnce(KTX);

        expect(get).toHaveBeenCalledTimes(2);
        expect(get.mock.calls[1][1].params.counted).toBe(1);
    });

    it('kamera lain adalah konteks lain - penandanya belum ada, jadi ia dihitung', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce(KTX);

        await resolveCommercialSlotOnce({ placement: 'popup', cameraId: 1445 });

        expect(get.mock.calls[1][1].params.counted).toBeUndefined();
    });

    it('permukaan lain adalah konteks lain - beranda lalu popup itu dua impresi yang sah', async () => {
        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce({ placement: 'landing' });

        await resolveCommercialSlotOnce({ placement: 'popup' });

        expect(get.mock.calls[1][1].params.counted).toBeUndefined();
    });

    it('konteks TANPA penghuni tidak ditandai - tawaran yang baru terbit tetap terhitung', async () => {
        balas(null);
        await resolveCommercialSlotOnce(KTX);

        balas({ kind: 'affiliate', content: BERSIH });
        await resolveCommercialSlotOnce(KTX);

        expect(get.mock.calls[1][1].params.counted).toBeUndefined();
    });

    it('membuang singgahan MUATAN versi lama yang masih menggantung di tab terbuka', async () => {
        // Tab yang sudah terbuka sejak sebelum perbaikan menyimpan judul lama sampai ditutup - dan
        // pengunjung paling setia justru yang tabnya paling lama terbuka.
        const kunciLama = `raf:slot:2026-08-27:popup:c1444:a0`;
        sessionStorage.setItem(kunciLama, JSON.stringify({ kind: 'affiliate', content: BERSIH }));
        balas({ kind: 'affiliate', content: BERSIH });

        await resolveCommercialSlotOnce(KTX);

        expect(sessionStorage.getItem(kunciLama), 'muatan basi versi lama masih tersimpan').toBeNull();
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
