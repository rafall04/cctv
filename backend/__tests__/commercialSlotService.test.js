/**
 * Purpose: Kunci tangga prioritas satu slot komersial — satu pemenang, tidak pernah menumpuk.
 * Caller: Vitest.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Sebelum arbiter, satu permukaan bisa menampilkan kartu afiliasi DAN banner promo DAN dua slot
 * iklan sekaligus, karena tiap sistem memutuskan sendiri tanpa tahu yang lain ada. Yang dijual
 * permukaan ini adalah KELANGKAAN — CTR 12,6% lawan norma display di bawah 1% — jadi "berhenti di
 * yang pertama cocok" bukan detail implementasi, melainkan produknya.
 *
 * Tiap tes di sini dipasangkan dengan mutasi yang dibunuhnya.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

const resolveOfferForContext = vi.fn();
const resolvePromoBannerForContext = vi.fn();

vi.mock('../services/affiliateOfferService.js', () => ({
    default: { resolveOfferForContext: (...a) => resolveOfferForContext(...a) },
}));
vi.mock('../services/promoBannerService.js', () => ({
    resolvePromoBannerForContext: (...a) => resolvePromoBannerForContext(...a),
}));

const { resolveCommercialSlot, SLOT_PLACEMENTS } = await import('../services/commercialSlotService.js');

const TAWARAN = { id: 7, product_title: 'CCTV Imou PS3D', product_href: '/go?l=p' };
const PROMO_LENGKAP = { id: 3, title: 'Pemasangan CCTV Gratis', image_base: 'promo-3', cta_url: 'https://wa.me/628...' };

beforeEach(() => {
    resolveOfferForContext.mockReset();
    resolvePromoBannerForContext.mockReset();
    resolveOfferForContext.mockReturnValue(null);
    resolvePromoBannerForContext.mockReturnValue(null);
});

describe('satu slot, satu penghuni', () => {
    it('afiliasi menang, dan promo bahkan tidak ditanya', () => {
        resolveOfferForContext.mockReturnValue(TAWARAN);
        resolvePromoBannerForContext.mockReturnValue(PROMO_LENGKAP);

        const hasil = resolveCommercialSlot({ placement: 'popup', cameraId: 1444 });

        expect(hasil).toEqual({ kind: 'affiliate', content: TAWARAN });
        expect(resolvePromoBannerForContext, 'berhenti di yang pertama cocok').not.toHaveBeenCalled();
    });

    it('promo menang hanya ketika tidak ada tawaran afiliasi', () => {
        resolvePromoBannerForContext.mockReturnValue(PROMO_LENGKAP);

        const hasil = resolveCommercialSlot({ placement: 'popup', cameraId: 1444 });

        expect(hasil).toEqual({ kind: 'promo', content: PROMO_LENGKAP });
    });

    it('mengembalikan null ketika tidak ada yang layak - slotnya tidak dirender sama sekali', () => {
        expect(resolveCommercialSlot({ placement: 'popup', cameraId: 1444 })).toBeNull();
    });

    it('tidak pernah mengembalikan dua penghuni sekaligus', () => {
        resolveOfferForContext.mockReturnValue(TAWARAN);
        resolvePromoBannerForContext.mockReturnValue(PROMO_LENGKAP);

        const hasil = resolveCommercialSlot({ placement: 'playback', cameraId: 1 });

        expect(Object.keys(hasil)).toEqual(['kind', 'content']);
        expect(Array.isArray(hasil.content)).toBe(false);
    });
});

describe('promo yang tidak bisa ditindaklanjuti tidak menempati slot', () => {
    /*
     * Banner "Pemasangan CCTV Gratis" tercatat 1.402 impresi dengan 0 klik justru karena cta_url
     * DAN whatsapp_number sama-sama kosong sehingga tombolnya tidak pernah dirender. Blok yang
     * tidak bisa ditindaklanjuti bukan sekadar tidak berguna - ia memakai slot yang bisa diisi
     * sesuatu yang bisa diklik, dan mengajari pengunjung bahwa blok di sini tidak melakukan apa-apa.
     */
    it('menolak promo tanpa cta_url', () => {
        resolvePromoBannerForContext.mockReturnValue({ ...PROMO_LENGKAP, cta_url: null });
        expect(resolveCommercialSlot({ placement: 'popup' })).toBeNull();
    });

    it('menolak promo tanpa image_base', () => {
        // "tidak ada promo" bisa tiba sebagai objek kosong yang cukup truthy untuk merender
        // <img> yang rusak - alasan yang sama seperti penjaga di PromoBanner.
        resolvePromoBannerForContext.mockReturnValue({ ...PROMO_LENGKAP, image_base: null });
        expect(resolveCommercialSlot({ placement: 'popup' })).toBeNull();
    });

    it('menerima promo yang lengkap', () => {
        resolvePromoBannerForContext.mockReturnValue(PROMO_LENGKAP);
        expect(resolveCommercialSlot({ placement: 'popup' })?.kind).toBe('promo');
    });
});

describe('konteks diteruskan apa adanya ke kedua penyelesai', () => {
    it('meneruskan placement, cameraId, dan areaId', () => {
        resolveCommercialSlot({ placement: 'area', cameraId: 12, areaId: 3 });

        expect(resolveOfferForContext).toHaveBeenCalledWith({ placement: 'area', cameraId: 12, areaId: 3 });
        expect(resolvePromoBannerForContext).toHaveBeenCalledWith({ placement: 'area', cameraId: 12, areaId: 3 });
    });

    it('id yang tidak diberikan menjadi null, bukan undefined', () => {
        resolveCommercialSlot({ placement: 'landing' });
        expect(resolveOfferForContext).toHaveBeenCalledWith({ placement: 'landing', cameraId: null, areaId: null });
    });
});

describe('permukaan tak dikenal ditolak sebelum menyentuh apa pun', () => {
    for (const buruk of ['', 'popupX', 'admin', null, undefined, 'POPUP']) {
        it(`menolak ${JSON.stringify(buruk)}`, () => {
            expect(resolveCommercialSlot({ placement: buruk })).toBeNull();
            expect(resolveOfferForContext).not.toHaveBeenCalled();
            expect(resolvePromoBannerForContext).not.toHaveBeenCalled();
        });
    }

    it('menerima keempat permukaan yang sah', () => {
        expect(SLOT_PLACEMENTS).toEqual(['popup', 'area', 'landing', 'playback']);
        for (const p of SLOT_PLACEMENTS) {
            resolveOfferForContext.mockReturnValue(TAWARAN);
            expect(resolveCommercialSlot({ placement: p })?.kind, p).toBe('affiliate');
        }
    });

    it('tidak melempar ketika dipanggil tanpa argumen sama sekali', () => {
        expect(() => resolveCommercialSlot()).not.toThrow();
        expect(resolveCommercialSlot()).toBeNull();
    });
});
